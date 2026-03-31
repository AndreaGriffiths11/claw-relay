// Browser engine using playwright-core over Chrome DevTools Protocol.

import { chromium, type Browser, type Page, type ElementHandle } from 'playwright-core';
import { ActionMessage } from './protocol';
import { isAllowed } from './allowlist';

// Flatten Playwright's nested accessibility tree into a flat list for wire format
interface AXNode {
  role: string;
  name?: string;
  value?: string;
  focused?: boolean;
  disabled?: boolean;
  checked?: boolean | 'mixed';
  children?: AXNode[];
}

export class Engine {
  private browser: Browser | null = null;
  private readonly timeout: number;
  private readonly cdpUrl: string;
  private consoleMessages: Array<{ level: string; text: string; timestamp: number }> = [];
  private networkRequests: Array<{ url: string; method: string; status?: number; timestamp: number }> = [];
  private blocklist: string[] = [];
  private allowlists: Map<string, string[]> = new Map();
  private currentAgentId: string | null = null;

  // Stable page IDs since Playwright doesn't expose Chrome target IDs
  private pageIds = new Map<Page, string>();
  private nextPageId = 1;

  // Ref map: sequential refs (e0, e1, ...) → backendDOMNodeId
  private refCounter = 0;
  private refMap = new Map<string, number>();

  private static readonly REF_ROLES = new Set([
    'textbox', 'button', 'link', 'checkbox', 'radio', 'combobox',
    'menuitem', 'tab', 'switch', 'slider', 'searchbox', 'option',
    'listbox', 'menu', 'tree', 'treeitem', 'heading',
  ]);

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
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.connectOverCDP(this.cdpUrl);
    return this.browser;
  }

  private getPageId(page: Page): string {
    if (!this.pageIds.has(page)) {
      this.pageIds.set(page, `tab-${this.nextPageId++}`);
    }
    return this.pageIds.get(page)!;
  }

  private listenedPages = new WeakSet<Page>();

  private setupPageListeners(page: Page): void {
    if (this.listenedPages.has(page)) return;
    this.listenedPages.add(page);
    // Ensure stable ID is assigned
    this.getPageId(page);

    // SSRF: block redirects to disallowed URLs
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

    // Console message buffer
    page.on('console', msg => {
      this.consoleMessages.push({
        level: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
      if (this.consoleMessages.length > 1000) this.consoleMessages.splice(0, 500);
    });

    // Network request buffer — use response event for status codes
    page.on('response', resp => {
      this.networkRequests.push({
        url: resp.url(),
        method: resp.request().method(),
        status: resp.status(),
        timestamp: Date.now(),
      });
      if (this.networkRequests.length > 1000) this.networkRequests.splice(0, 500);
    });
  }

  private getPages(browser: Browser): Page[] {
    return browser.contexts().flatMap(ctx => ctx.pages());
  }

  private async getActivePage(createIfMissing = false): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = this.getPages(browser);
    const browsable = pages.filter(p => {
      const url = p.url();
      return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank';
    });
    if (browsable.length === 0) {
      if (createIfMissing) {
        const ctx = browser.contexts()[0] ?? await browser.newContext();
        if (!ctx) throw new Error('No browser context');
        const newPage = await ctx.newPage();
        this.setupPageListeners(newPage);
        return newPage;
      }
      throw new Error('No browser tabs open');
    }
    const activePage = browsable[browsable.length - 1];
    this.setupPageListeners(activePage);
    return activePage;
  }

  private async getPageByTargetId(targetId: string): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = this.getPages(browser);
    for (const page of pages) {
      if (this.getPageId(page) === targetId) return page;
    }
    throw new Error(`Tab not found: ${targetId}`);
  }

  private async findElement(page: Page, ref?: string, selector?: string): Promise<ElementHandle> {
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`Element not found: ${selector}`);
      return el;
    }
    if (ref) {
      return await this.findByRef(page, ref);
    }
    throw new Error('Must provide ref or selector');
  }

  async execute(msg: ActionMessage): Promise<{ ok: boolean; data?: string; error?: string; targetId?: string }> {
    try {
      const page = msg.targetId
        ? await this.getPageByTargetId(msg.targetId)
        : msg.type === 'navigate'
          ? await this.getActivePage(true)
          : await this.getActivePage();
      this.setupPageListeners(page);
      const result = await this.runAction(msg, page);
      const targetId = this.getPageId(page);
      return { ok: true, data: result, targetId };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: errMsg };
    }
  }

  private async runAction(msg: ActionMessage, page: Page): Promise<string | undefined> {
    switch (msg.type) {
      case 'snapshot':
        return await this.snapshot(page);

      case 'screenshot': {
        if (msg.ref || msg.element) {
          const el = await this.findElement(page, msg.ref, msg.element);
          const buf = await el.screenshot({ type: (msg.imageType as 'png' | 'jpeg') || 'png' });
          return Buffer.from(buf).toString('base64');
        }
        const buf = await page.screenshot({
          type: (msg.imageType as 'png' | 'jpeg') || 'png',
          fullPage: msg.fullPage || false,
        });
        return Buffer.from(buf).toString('base64');
      }

      case 'navigate':
        await page.goto(msg.url!, { timeout: this.timeout, waitUntil: 'domcontentloaded' });
        return `Navigated to ${msg.url}`;

      case 'click': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.click({
          clickCount: msg.doubleClick ? 2 : 1,
          button: (msg.button as 'left' | 'right' | 'middle') || 'left',
          delay: msg.delayMs,
        });
        return `Clicked ${msg.ref || msg.selector}`;
      }

      case 'hover': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.hover();
        return `Hovered ${msg.ref || msg.selector}`;
      }

      case 'fill': {
        if (msg.fields && msg.fields.length > 0) {
          for (const field of msg.fields) {
            const el = await this.findByRef(page, field.ref);
            await el.click({ clickCount: 3 });
            await el.type(String(field.value ?? ''));
          }
          return `Filled ${msg.fields.length} fields`;
        }
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.click({ clickCount: 3 });
        await el.type(msg.text!);
        return `Filled ${msg.ref || msg.selector}`;
      }

      case 'type': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.type(msg.text!, { delay: msg.slowly ? 100 : 50 });
        if (msg.submit) await page.keyboard.press('Enter');
        return `Typed into ${msg.ref || msg.selector}`;
      }

      case 'press':
        await page.keyboard.press(msg.key!);
        return `Pressed ${msg.key}`;

      case 'evaluate': {
        const code = msg.js || msg.fn;
        if (!code) throw new Error('Must provide js or fn');
        const result = await page.evaluate(code);
        return result !== undefined ? JSON.stringify(result) : undefined;
      }

      case 'select': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.selectOption(msg.values || []);
        return `Selected ${msg.values?.join(', ')} in ${msg.ref || msg.selector}`;
      }

      case 'close': {
        const browser = await this.getBrowser();
        const allPages = this.getPages(browser);
        const activePage = allPages[allPages.length - 1];
        if (allPages.length > 1) {
          await activePage.close();
          return 'Tab closed';
        }
        await activePage.goto('about:blank');
        return 'Navigated to blank';
      }

      case 'drag': {
        const start = await this.findElement(page, msg.startRef);
        const end = await this.findElement(page, msg.endRef);
        const startBox = await start.boundingBox();
        const endBox = await end.boundingBox();
        if (!startBox || !endBox) throw new Error('Cannot get element positions for drag');
        await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
        await page.mouse.up();
        return `Dragged from ${msg.startRef} to ${msg.endRef}`;
      }

      case 'scrollIntoView': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.evaluate((node: any) => node.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        return `Scrolled ${msg.ref || msg.selector} into view`;
      }

      case 'wait': {
        if (msg.timeMs) {
          await new Promise(r => setTimeout(r, msg.timeMs));
          return `Waited ${msg.timeMs}ms`;
        }
        if (msg.text) {
          await page.waitForFunction(
            `document.body && document.body.innerText.includes(${JSON.stringify(msg.text)})`,
            { timeout: msg.timeoutMs || this.timeout }
          );
          return `Text "${msg.text}" appeared`;
        }
        if (msg.textGone) {
          await page.waitForFunction(
            `!(document.body && document.body.innerText.includes(${JSON.stringify(msg.textGone)}))`,
            { timeout: msg.timeoutMs || this.timeout }
          );
          return `Text "${msg.textGone}" gone`;
        }
        if (msg.selector) {
          await page.locator(msg.selector).waitFor({ timeout: msg.timeoutMs || this.timeout });
          return `Selector "${msg.selector}" appeared`;
        }
        if (msg.url) {
          await page.waitForFunction(
            `window.location.href.includes(${JSON.stringify(msg.url)})`,
            { timeout: msg.timeoutMs || this.timeout }
          );
          return `URL contains "${msg.url}"`;
        }
        if (msg.loadState) {
          const state = msg.loadState === 'networkidle' ? 'networkidle' : msg.loadState as 'load' | 'domcontentloaded';
          await page.waitForLoadState(state, { timeout: msg.timeoutMs || this.timeout });
          return `Page reached ${msg.loadState}`;
        }
        if (msg.fn) {
          await page.waitForFunction(msg.fn, { timeout: msg.timeoutMs || this.timeout });
          return 'Function condition met';
        }
        return 'Nothing to wait for';
      }

      case 'resize': {
        await page.setViewportSize({ width: msg.width!, height: msg.height! });
        return `Resized to ${msg.width}x${msg.height}`;
      }

      case 'batch': {
        // Security: batch is handled at the protocol layer (index.ts)
        // to ensure each sub-action passes permission/rate-limit/blocklist checks.
        // If called directly, reject.
        throw new Error('batch must be handled at the protocol layer, not engine');
      }

      case 'console': {
        let messages = this.consoleMessages;
        if (msg.level) messages = messages.filter(m => m.level === msg.level);
        if (msg.clear) this.consoleMessages = [];
        return JSON.stringify(messages.slice(-100));
      }

      case 'network': {
        let requests = this.networkRequests;
        if (msg.filter) requests = requests.filter(r => r.url.includes(msg.filter!));
        if (msg.clear) this.networkRequests = [];
        return JSON.stringify(requests.slice(-100));
      }

      case 'pdf': {
        const buf = await page.pdf({ printBackground: true });
        return Buffer.from(buf).toString('base64');
      }

      default:
        throw new Error(`Unknown action: ${msg.type}`);
    }
  }

  private async snapshot(page: Page): Promise<string> {
    // Use CDP session for accessibility tree (page.accessibility is deprecated)
    const cdp = await page.context().newCDPSession(page);
    try {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: any[] };
      const tree = this.formatAXTreeFlat(nodes);

      // Clean up old data-claw-ref attributes
      await cdp.send('Runtime.evaluate', {
        expression: 'document.querySelectorAll("[data-claw-ref]").forEach(el => el.removeAttribute("data-claw-ref"))',
      });

      // Inject data-claw-ref attributes for each mapped ref
      for (const [ref, backendNodeId] of this.refMap.entries()) {
        try {
          const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
          if (object?.objectId) {
            await cdp.send('Runtime.callFunctionOn', {
              objectId: object.objectId,
              functionDeclaration: `function() { this.setAttribute('data-claw-ref', '${ref}'); }`,
              arguments: [],
            });
          }
        } catch {
          // Node may not be in DOM (e.g. virtual/offscreen)
        }
      }

      return tree;
    } finally {
      await cdp.detach();
    }
  }

  private formatAXTreeFlat(nodes: any[]): string {
    // Reset ref map for each snapshot
    this.refCounter = 0;
    this.refMap.clear();

    const lines: string[] = [];
    for (const node of nodes) {
      const name = node.name?.value || '';
      const role = node.role?.value || '';
      const value = node.value?.value || '';
      if (role === 'none' || role === 'generic') continue;
      if (!name && !value && role === 'StaticText') continue;

      // Assign sequential ref for interactive roles with a backendDOMNodeId
      const backendId: number | undefined = node.backendDOMNodeId;
      let label: string;
      if (backendId !== undefined && Engine.REF_ROLES.has(role)) {
        const ref = `e${this.refCounter++}`;
        this.refMap.set(ref, backendId);
        label = ref;
      } else {
        label = node.nodeId || '';
      }

      let line = `[${label}] ${role}`;
      if (name) line += ` "${name}"`;
      if (value) line += ` value="${value}"`;

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

  private async findByRef(page: Page, ref: string): Promise<ElementHandle> {
    // Check ref map first (e.g. "e5")
    if (/^e\d+$/.test(ref)) {
      const el = await page.$(`[data-claw-ref="${ref}"]`);
      if (el) return el;
      throw new Error(`Ref ${ref} not found — snapshot may be stale. Take a new snapshot.`);
    }

    const escaped = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let el = await page.$(`[aria-label="${escaped}"]`)
      ?? await page.$(`[name="${escaped}"]`)
      ?? await page.$(`[id="${escaped}"]`)
      ?? await page.$(`[placeholder="${escaped}"]`);

    if (!el) {
      // Fallback to text content via locator
      const loc = page.getByText(ref, { exact: false });
      if (await loc.count() > 0) {
        el = await loc.first().elementHandle();
      }
    }

    if (!el) throw new Error(`Element not found: ${ref}`);
    return el;
  }

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
