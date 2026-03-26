/* ============================================================
 *  Claw Relay – Background Service Worker
 *  Health-check monitor  +  TabBridge (chrome.debugger bridge)
 * ============================================================ */

const DEFAULTS = {
  relayUrl: 'ws://localhost:9333',
  apiKey: '',
  agentId: 'my-agent'
};
const CHECK_INTERVAL = 30000;

let currentSettings = { ...DEFAULTS };

// ── Ref-system constants (mirrors engine.ts) ────────────────
const REF_ROLES = new Set([
  'textbox', 'button', 'link', 'checkbox', 'radio', 'combobox',
  'menuitem', 'tab', 'switch', 'slider', 'searchbox', 'option',
  'listbox', 'menu', 'tree', 'treeitem', 'heading'
]);

// ── TabBridge ───────────────────────────────────────────────
class TabBridge {
  constructor() {
    this.attachedTabs = new Map(); // tabId → { refs: Map }
    this.ws = null;
    this.refCounter = 0;
    this.refMap = new Map(); // "e0" → { tabId, backendNodeId, objectId }
    this.reconnectTimer = null;
    this.connected = false;
  }

  // ── WebSocket lifecycle ─────────────────────────────────
  connect(url, token, agentId) {
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* ignore */ }
    }
    const wsUrl = url.replace(/\/$/, '') + '/ws';
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener('open', () => {
      this.connected = true;
      // Authenticate as extension client
      this.ws.send(JSON.stringify({
        type: 'auth',
        clientType: 'extension',
        token: token,
        agentId: agentId
      }));
      this._updateBadge();
    });

    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'action') {
        this.handleAction(msg).then(result => {
          this.ws.send(JSON.stringify({
            type: 'action-result',
            id: msg.id,
            result
          }));
        }).catch(err => {
          this.ws.send(JSON.stringify({
            type: 'action-result',
            id: msg.id,
            error: String(err)
          }));
        });
      }
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this._updateBadge();
      this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.connected = false;
      this._updateBadge();
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
    this._updateBadge();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected && currentSettings.apiKey) {
        this.connect(currentSettings.relayUrl, currentSettings.apiKey, currentSettings.agentId);
      }
    }, 5000);
  }

  _updateBadge() {
    const count = this.attachedTabs.size;
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#58a6ff' });
    }
    // If no attached tabs, let health-check badge take over
    else if (!this.connected) {
      // leave for health-check
    }
  }

  // ── Tab attach / detach ─────────────────────────────────
  async attachTab(tabId) {
    if (this.attachedTabs.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Accessibility.enable');
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    this.attachedTabs.set(tabId, { refs: new Map() });
    this._updateBadge();
    this._broadcastState();
  }

  async detachTab(tabId) {
    if (!this.attachedTabs.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) { /* may already be detached */ }
    this.attachedTabs.delete(tabId);
    // Clean up refs for this tab
    for (const [ref, info] of this.refMap) {
      if (info.tabId === tabId) this.refMap.delete(ref);
    }
    this._updateBadge();
    this._broadcastState();
  }

  _broadcastState() {
    chrome.runtime.sendMessage({
      type: 'bridge-state',
      attachedTabs: Array.from(this.attachedTabs.keys()),
      wsConnected: this.connected
    }).catch(() => {}); // popup may not be open
  }

  // ── Resolve target tab ──────────────────────────────────
  _resolveTab(msg) {
    if (msg.tabId && this.attachedTabs.has(msg.tabId)) return msg.tabId;
    // Default: first attached tab
    const first = this.attachedTabs.keys().next();
    if (first.done) throw new Error('No attached tabs');
    return first.value;
  }

  // ── Action dispatcher ───────────────────────────────────
  async handleAction(msg) {
    const action = msg.action || msg.type;
    const tabId = this._resolveTab(msg);

    switch (action) {
      case 'snapshot':  return this.snapshot(tabId);
      case 'screenshot': return this.screenshot(tabId);
      case 'click':     return this.click(tabId, msg.ref, msg.selector);
      case 'fill':      return this.fill(tabId, msg.ref, msg.text);
      case 'type':      return this.typeText(tabId, msg.ref, msg.text, msg.delayMs);
      case 'press':     return this.press(tabId, msg.key);
      case 'navigate':  return this.navigate(tabId, msg.url);
      case 'evaluate':  return this.evaluate(tabId, msg.js || msg.expression);
      default:          return { error: `Unknown action: ${action}` };
    }
  }

  // ── Snapshot (Accessibility tree → ref-mapped output) ───
  async snapshot(tabId) {
    this.refCounter = 0;
    this.refMap.clear();

    const tree = await chrome.debugger.sendCommand(
      { tabId }, 'Accessibility.getFullAXTree'
    );

    const lines = [];
    const nodes = tree.nodes || [];

    for (const node of nodes) {
      const role = (node.role && node.role.value) || '';
      const name = (node.name && node.name.value) || '';
      const ignored = node.ignored || false;

      if (ignored) continue;

      const roleLower = role.toLowerCase();
      const isInteractive = REF_ROLES.has(roleLower);

      if (!isInteractive && !name) continue;

      let refTag = '';
      if (isInteractive) {
        const ref = `e${this.refCounter++}`;
        this.refMap.set(ref, {
          tabId,
          backendNodeId: node.backendDOMNodeId || null,
          nodeId: node.nodeId
        });
        refTag = `[${ref}] `;

        // Inject data-claw-ref attribute on the DOM node
        if (node.backendDOMNodeId) {
          try {
            await chrome.debugger.sendCommand({ tabId }, 'DOM.setAttributeValue', {
              nodeId: await this._resolveNodeId(tabId, node.backendDOMNodeId),
              name: 'data-claw-ref',
              value: ref
            });
          } catch (_) { /* best effort */ }
        }
      }

      const focused = (node.focused) ? ' (focused)' : '';
      const value = (node.value && node.value.value) ? ` value="${node.value.value}"` : '';
      const checked = (node.checked && node.checked.value) ? ' (checked)' : '';
      const line = `${refTag}${roleLower} "${name}"${value}${checked}${focused}`;
      lines.push(line);
    }

    return { content: lines.join('\n'), refs: this.refCounter };
  }

  async _resolveNodeId(tabId, backendNodeId) {
    const result = await chrome.debugger.sendCommand({ tabId }, 'DOM.describeNode', {
      backendNodeId
    });
    return result.node.nodeId;
  }

  // ── Screenshot ──────────────────────────────────────────
  async screenshot(tabId) {
    const result = await chrome.debugger.sendCommand(
      { tabId }, 'Page.captureScreenshot', { format: 'png' }
    );
    return { data: result.data, mimeType: 'image/png' };
  }

  // ── Click ───────────────────────────────────────────────
  async click(tabId, ref, selector) {
    const box = await this._getBoundingBox(tabId, ref, selector);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });
    return { ok: true };
  }

  // ── Fill (clear + type) ─────────────────────────────────
  async fill(tabId, ref, text) {
    await this._focusElement(tabId, ref);
    // Select all + delete to clear
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 // Ctrl
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace'
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace'
    });
    // Insert text
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
    return { ok: true };
  }

  // ── Type (character by character) ───────────────────────
  async typeText(tabId, ref, text, delayMs) {
    if (ref) await this._focusElement(tabId, ref);
    const delay = delayMs || 0;
    for (const ch of text) {
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: ch, text: ch
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: ch
      });
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
    return { ok: true };
  }

  // ── Press (single key) ─────────────────────────────────
  async press(tabId, key) {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key, code: key
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key, code: key
    });
    return { ok: true };
  }

  // ── Navigate ────────────────────────────────────────────
  async navigate(tabId, url) {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.navigate', { url });
    return { frameId: result.frameId };
  }

  // ── Evaluate JS ─────────────────────────────────────────
  async evaluate(tabId, js) {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      return { error: result.exceptionDetails.text || 'Evaluation error' };
    }
    return { value: result.result?.value };
  }

  // ── Helpers ─────────────────────────────────────────────
  async _focusElement(tabId, ref) {
    if (!ref) return;
    const info = this.refMap.get(ref);
    if (!info) throw new Error(`Unknown ref: ${ref}`);
    if (info.backendNodeId) {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.focus', {
        backendNodeId: info.backendNodeId
      });
    } else {
      // Fallback: use data-claw-ref selector
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `document.querySelector('[data-claw-ref="${ref}"]')?.focus()`
      });
    }
  }

  async _getBoundingBox(tabId, ref, selector) {
    let jsExpr;
    if (ref) {
      jsExpr = `JSON.stringify(document.querySelector('[data-claw-ref="${ref}"]')?.getBoundingClientRect())`;
    } else if (selector) {
      jsExpr = `JSON.stringify(document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect())`;
    } else {
      throw new Error('click requires ref or selector');
    }

    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: jsExpr, returnByValue: true
    });

    const box = result.result?.value;
    if (!box) throw new Error('Element not found or not visible');
    const parsed = typeof box === 'string' ? JSON.parse(box) : box;
    if (!parsed || parsed.width === 0) throw new Error('Element has zero size');
    return parsed;
  }
}

// ── Singleton bridge instance ─────────────────────────────
const bridge = new TabBridge();

// ── Handle debugger detach (user closed debugger bar) ─────
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId && bridge.attachedTabs.has(source.tabId)) {
    bridge.attachedTabs.delete(source.tabId);
    for (const [ref, info] of bridge.refMap) {
      if (info.tabId === source.tabId) bridge.refMap.delete(ref);
    }
    bridge._updateBadge();
    bridge._broadcastState();
  }
});

// ── Handle tab removal ────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (bridge.attachedTabs.has(tabId)) {
    bridge.attachedTabs.delete(tabId);
    for (const [ref, info] of bridge.refMap) {
      if (info.tabId === tabId) bridge.refMap.delete(ref);
    }
    bridge._updateBadge();
    bridge._broadcastState();
  }
});

// ── Health check (original functionality) ─────────────────
function getHealthUrl() {
  return currentSettings.relayUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/$/, '') + '/health';
}

async function checkHealth() {
  try {
    const headers = {};
    if (currentSettings.apiKey) {
      headers['Authorization'] = `Bearer ${currentSettings.apiKey}`;
    }
    const resp = await fetch(getHealthUrl(), {
      signal: AbortSignal.timeout(5000),
      headers
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      // Only set badge if no attached tabs (bridge badge takes priority)
      if (bridge.attachedTabs.size === 0) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#39d353' });
      }
      chrome.storage.local.set({
        connected: true,
        lastCheck: Date.now(),
        agent: data.agent || null,
        recentActions: data.recentActions || []
      });
    } else {
      setOffline();
    }
  } catch {
    setOffline();
  }
}

function setOffline() {
  if (bridge.attachedTabs.size === 0) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff7b72' });
  }
  chrome.storage.local.set({ connected: false, lastCheck: Date.now() });
}

function loadSettingsAndCheck() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    currentSettings = items;
    checkHealth();
  });
}

// ── Message handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Original toggle
  if (msg.type === 'toggle') {
    if (msg.paused) {
      chrome.action.setBadgeText({ text: '⏸' });
      chrome.action.setBadgeBackgroundColor({ color: '#d29922' });
    } else {
      loadSettingsAndCheck();
    }
  }
  if (msg.type === 'settingsChanged') {
    currentSettings = { ...DEFAULTS, ...msg.settings };
    checkHealth();
  }

  // Bridge messages
  if (msg.type === 'attach-tab') {
    bridge.attachTab(msg.tabId).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ error: String(err) });
    });
    return true; // async response
  }
  if (msg.type === 'detach-tab') {
    bridge.detachTab(msg.tabId).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ error: String(err) });
    });
    return true;
  }
  if (msg.type === 'get-bridge-state') {
    sendResponse({
      attachedTabs: Array.from(bridge.attachedTabs.keys()),
      wsConnected: bridge.connected
    });
    return false;
  }
  if (msg.type === 'connect-bridge') {
    bridge.connect(currentSettings.relayUrl, currentSettings.apiKey, currentSettings.agentId);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'disconnect-bridge') {
    bridge.disconnect();
    sendResponse({ ok: true });
    return false;
  }
});

// ── Initial load + periodic health check ──────────────────
loadSettingsAndCheck();
setInterval(() => loadSettingsAndCheck(), CHECK_INTERVAL);
