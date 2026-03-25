// Browser engine using puppeteer-core over Chrome DevTools Protocol.

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { ActionMessage } from './protocol';

export class Engine {
  private browser: Browser | null = null;
  private readonly timeout: number;
  private readonly cdpUrl: string;
  private consoleMessages: Array<{ level: string; text: string; timestamp: number }> = [];
  private networkRequests: Array<{ url: string; method: string; status?: number; timestamp: number }> = [];

  constructor(timeout: number, cdpUrl = 'http://127.0.0.1:9222') {
    this.timeout = timeout;
    this.cdpUrl = cdpUrl;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.browser = await puppeteer.connect({ browserURL: this.cdpUrl, defaultViewport: null });
    return this.browser;
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
        return await browser.newPage();
      }
      throw new Error('No browser tabs open');
    }
    return browsable[browsable.length - 1];
  }

  private async getPageByTargetId(targetId: string): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    const page = pages.find(p => {
      const target = p.target();
      return target.url() !== '' && (target as any)._targetId === targetId;
    });
    if (!page) throw new Error(`Tab not found: ${targetId}`);
    return page;
  }

  private setupPageListeners(page: Page): void {
    if ((page as any)._relayListenersAttached) return;
    (page as any)._relayListenersAttached = true;
    page.on('console', msg => {
      this.consoleMessages.push({
        level: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
      if (this.consoleMessages.length > 1000) this.consoleMessages.splice(0, 500);
    });
    page.on('requestfinished', req => {
      const resp = req.response();
      this.networkRequests.push({
        url: req.url(),
        method: req.method(),
        status: resp?.status(),
        timestamp: Date.now(),
      });
      if (this.networkRequests.length > 1000) this.networkRequests.splice(0, 500);
    });
  }

  private async findElement(page: Page, ref?: string, selector?: string) {
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
      const targetId = (page.target() as any)?._targetId;
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
        const cdp = await page.createCDPSession();
        try {
          const { data } = await cdp.send('Page.captureScreenshot', {
            format: (msg.imageType as 'png' | 'jpeg' | 'webp') || 'png',
            captureBeyondViewport: msg.fullPage || false,
          });
          return data;
        } finally {
          await cdp.detach();
        }
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
        await page.keyboard.press(msg.key! as any);
        return `Pressed ${msg.key}`;

      case 'evaluate': {
        const code = msg.js || msg.fn;
        if (!code) throw new Error('Must provide js or fn');
        const result = await page.evaluate(code);
        return result !== undefined ? JSON.stringify(result) : undefined;
      }

      case 'select': {
        const el = await this.findElement(page, msg.ref, msg.selector);
        await el.select(...(msg.values || []));
        return `Selected ${msg.values?.join(', ')} in ${msg.ref || msg.selector}`;
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
        await el.evaluate('(node) => node.scrollIntoView({ block: "center", behavior: "smooth" })');
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
          await page.waitForSelector(msg.selector, { timeout: msg.timeoutMs || this.timeout });
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
          const waitUntil = msg.loadState as 'load' | 'domcontentloaded' | 'networkidle0';
          const state = msg.loadState === 'networkidle' ? 'networkidle0' : waitUntil;
          await page.waitForNavigation({ waitUntil: state, timeout: msg.timeoutMs || this.timeout });
          return `Page reached ${msg.loadState}`;
        }
        if (msg.fn) {
          await page.waitForFunction(msg.fn, { timeout: msg.timeoutMs || this.timeout });
          return 'Function condition met';
        }
        return 'Nothing to wait for';
      }

      case 'resize': {
        await page.setViewport({ width: msg.width!, height: msg.height! });
        return `Resized to ${msg.width}x${msg.height}`;
      }

      case 'batch': {
        const results: Array<{ ok: boolean; error?: string }> = [];
        for (const action of (msg.actions || [])) {
          try {
            await this.runAction(action, page);
            results.push({ ok: true });
          } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            results.push({ ok: false, error: err });
            if (msg.stopOnError) break;
          }
        }
        return JSON.stringify({ results });
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
        const cdp = await page.createCDPSession();
        try {
          const { data } = await cdp.send('Page.printToPDF', {
            printBackground: true,
            preferCSSPageSize: true,
          });
          return data;
        } finally {
          await cdp.detach();
        }
      }

      default:
        throw new Error(`Unknown action: ${msg.type}`);
    }
  }

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
