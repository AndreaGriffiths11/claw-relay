// Browser engine using puppeteer-core over Chrome DevTools Protocol.
// Replaces the previous agent-browser CLI shelling approach with
// direct CDP communication via puppeteer-core.

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { ActionMessage } from './protocol';
import { isAllowed } from './allowlist';

export class Engine {
  private browser: Browser | null = null;
  private readonly timeout: number;
  private readonly cdpUrl: string;
  private blocklist: string[] = [];
  private allowlists: Map<string, string[]> = new Map();
  private currentAgentId: string | null = null;

  constructor(timeout: number, cdpUrl = 'http://127.0.0.1:9222') {
    this.timeout = timeout;
    this.cdpUrl = cdpUrl;
  }

  setRestrictions(agentId: string, allowlist: string[], blocklist: string[]): void {
    this.blocklist = blocklist;
    this.allowlists.set(agentId, allowlist);
    this.currentAgentId = agentId;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.browser = await puppeteer.connect({ browserURL: this.cdpUrl, defaultViewport: null });
    return this.browser;
  }

  private listenedPages = new WeakSet<Page>();

  private setupPageListeners(page: Page): void {
    if (this.listenedPages.has(page)) return;
    this.listenedPages.add(page);

    page.on('framenavigated', async (frame) => {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      const agentAllowlist = this.currentAgentId
        ? this.allowlists.get(this.currentAgentId) || ['*']
        : ['*'];
      const check = isAllowed(url, agentAllowlist, this.blocklist);
      if (!check.allowed) {
        console.warn(`Blocked redirect to ${url} — navigating to about:blank`);
        await page.goto('about:blank').catch(() => {});
      }
    });
  }

  private async getActivePage(createIfMissing = false): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    const browsable = pages.filter(p => {
      const url = p.url();
      return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
    });
    if (browsable.length === 0) {
      if (createIfMissing) {
        const page = await browser.newPage();
        this.setupPageListeners(page);
        return page;
      }
      throw new Error('No browser tabs open');
    }
    const page = browsable[browsable.length - 1];
    this.setupPageListeners(page);
    return page;
  }

  async execute(msg: ActionMessage): Promise<{ ok: boolean; data?: string; error?: string }> {
    try {
      const result = await this.runAction(msg);
      return { ok: true, data: result };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: errMsg };
    }
  }

  private async runAction(msg: ActionMessage): Promise<string | undefined> {
    // Navigate can create a tab if none exist
    const page = msg.type === 'navigate'
      ? await this.getActivePage(true)
      : await this.getActivePage();

    switch (msg.type) {
      case 'snapshot':
        return await this.snapshot(page);

      case 'screenshot':
        return await this.screenshot(page);

      case 'navigate':
        await page.goto(msg.url!, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
        return `Navigated to ${msg.url}`;

      case 'click':
        await this.clickByRef(page, msg.ref!);
        return `Clicked ${msg.ref}`;

      case 'hover':
        await this.hoverByRef(page, msg.ref!);
        return `Hovered ${msg.ref}`;

      case 'fill': {
        const el = await this.findByRef(page, msg.ref!);
        await el.click({ clickCount: 3 }); // select all
        await el.type(msg.text!);
        return `Filled ${msg.ref}`;
      }

      case 'type': {
        const el = await this.findByRef(page, msg.ref!);
        await el.type(msg.text!, { delay: 50 });
        return `Typed into ${msg.ref}`;
      }

      case 'press':
        await page.keyboard.press(msg.key! as any);
        return `Pressed ${msg.key}`;

      case 'evaluate': {
        const result = await page.evaluate(msg.js!);
        return result !== undefined ? JSON.stringify(result) : undefined;
      }

      case 'select': {
        const el = await this.findByRef(page, msg.ref!);
        await el.select(...(msg.values || []));
        return `Selected ${msg.values?.join(', ')} in ${msg.ref}`;
      }

      case 'close': {
        const browser = await this.getBrowser();
        const allPages = await browser.pages();
        const activePage = allPages[allPages.length - 1];
        if (allPages.length > 1) {
          await activePage.close();
          return 'Tab closed';
        }
        await activePage.goto('about:blank');
        return 'Navigated to blank';
      }

      default:
        throw new Error(`Unknown action: ${msg.type}`);
    }
  }

  // Get accessibility tree snapshot via CDP
  private async snapshot(page: Page): Promise<string> {
    const cdp = await page.createCDPSession();
    try {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      return this.formatAXTree(nodes);
    } finally {
      await cdp.detach();
    }
  }

  private formatAXTree(nodes: any[]): string {
    const lines: string[] = [];
    for (const node of nodes) {
      const name = node.name?.value || '';
      const role = node.role?.value || '';
      const value = node.value?.value || '';
      if (role === 'none' || role === 'generic') continue;
      if (!name && !value && role === 'StaticText') continue;

      const id = node.nodeId || '';
      let line = `[${id}] ${role}`;
      if (name) line += ` "${name}"`;
      if (value) line += ` value="${value}"`;

      // Include useful properties
      const props = node.properties || [];
      for (const prop of props) {
        if (prop.name === 'focused' && prop.value?.value) line += ' (focused)';
        if (prop.name === 'disabled' && prop.value?.value) line += ' (disabled)';
        if (prop.name === 'checked' && prop.value?.value !== undefined) line += ` checked=${prop.value.value}`;
      }

      lines.push(line);
    }
    return lines.join('\n');
  }

  // Screenshot via CDP — returns base64
  private async screenshot(page: Page): Promise<string> {
    const cdp = await page.createCDPSession();
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      return data; // already base64
    } finally {
      await cdp.detach();
    }
  }

  // Find element by ref from the accessibility snapshot.
  // Refs are accessibility node IDs or aria labels — escape them
  // before interpolating into CSS attribute selectors to prevent injection.
  private async findByRef(page: Page, ref: string) {
    const escaped = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const el = await page.$(`[aria-label="${escaped}"]`)
      || await page.$(`[name="${escaped}"]`)
      || await page.$(`[id="${escaped}"]`)
      || await page.$(`[placeholder="${escaped}"]`)
      || await page.$(`::-p-text(${escaped})`);

    if (!el) throw new Error(`Element not found: ${ref}`);
    return el;
  }

  private async clickByRef(page: Page, ref: string) {
    const el = await this.findByRef(page, ref);
    await el.click();
  }

  private async hoverByRef(page: Page, ref: string) {
    const el = await this.findByRef(page, ref);
    await el.hover();
  }

  // URL caching for blocklist checks
  private cachedUrl: string | null = null;
  private cachedUrlAt: number = 0;
  private readonly URL_CACHE_TTL_MS = 2000;

  async getCurrentUrl(): Promise<string | null> {
    if (this.cachedUrl !== null && Date.now() - this.cachedUrlAt < this.URL_CACHE_TTL_MS) {
      return this.cachedUrl;
    }
    try {
      const page = await this.getActivePage();
      this.cachedUrl = page.url();
      this.cachedUrlAt = Date.now();
      return this.cachedUrl;
    } catch {
      return null;
    }
  }
}
