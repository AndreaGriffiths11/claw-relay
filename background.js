// Claw Relay — Background Service Worker
// Manages relay state, WebSocket coordination, and message routing

const STATE = {
  active: false,
  token: null,
  agentConnected: false,
  permissions: ['read', 'interact'],
  auditLog: [],
  wsPort: 19222,
};

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 12; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

function addAuditEntry(entry) {
  const record = { ...entry, timestamp: Date.now(), id: crypto.randomUUID() };
  STATE.auditLog.push(record);
  if (STATE.auditLog.length > 1000) STATE.auditLog.shift();
  chrome.storage.local.set({ auditLog: STATE.auditLog });
  // Notify devtools panel
  chrome.runtime.sendMessage({ type: 'audit_update', entry: record }).catch(() => {});
  return record;
}

// Listen for messages from popup / content scripts / devtools
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'get_state':
      sendResponse({ ...STATE });
      return true;

    case 'toggle_relay':
      STATE.active = msg.active;
      if (STATE.active && !STATE.token) {
        STATE.token = generateToken();
      }
      if (!STATE.active) {
        STATE.token = null;
        STATE.agentConnected = false;
      }
      chrome.storage.local.set({ relayActive: STATE.active, token: STATE.token });
      updateBadge();
      sendResponse({ ...STATE });
      return true;

    case 'revoke_access':
      STATE.token = generateToken();
      STATE.agentConnected = false;
      addAuditEntry({ action: 'revoke', detail: 'Access revoked by user' });
      chrome.storage.local.set({ token: STATE.token });
      updateBadge();
      sendResponse({ ...STATE });
      return true;

    case 'set_permissions':
      STATE.permissions = msg.permissions;
      chrome.storage.local.set({ permissions: STATE.permissions });
      addAuditEntry({ action: 'permissions_changed', detail: STATE.permissions.join(', ') });
      sendResponse({ ...STATE });
      return true;

    case 'get_audit_log':
      sendResponse({ log: STATE.auditLog });
      return true;

    case 'clear_audit_log':
      STATE.auditLog = [];
      chrome.storage.local.set({ auditLog: [] });
      sendResponse({ success: true });
      return true;

    // Messages from the offscreen/relay page
    case 'agent_connected':
      STATE.agentConnected = true;
      addAuditEntry({ action: 'agent_connected', detail: 'Agent connected' });
      updateBadge();
      sendResponse({ ok: true });
      return true;

    case 'agent_disconnected':
      STATE.agentConnected = false;
      addAuditEntry({ action: 'agent_disconnected', detail: 'Agent disconnected' });
      updateBadge();
      sendResponse({ ok: true });
      return true;

    case 'relay_request':
      handleRelayRequest(msg.request, sender).then(sendResponse);
      return true;
  }
});

async function handleRelayRequest(request, sender) {
  const { type } = request;

  // Permission check
  const permMap = {
    snapshot: 'read',
    status: 'read',
    click: 'interact',
    fill: 'interact',
    select: 'interact',
    navigate: 'navigate',
    evaluate: 'execute',
  };
  const needed = permMap[type] || 'full';
  if (!STATE.permissions.includes(needed) && !STATE.permissions.includes('full')) {
    return { type: 'error', error: `Permission denied: requires '${needed}'` };
  }

  addAuditEntry({ action: type, detail: JSON.stringify(request) });

  try {
    if (type === 'status') {
      return { type: 'status_result', active: STATE.active, permissions: STATE.permissions };
    }

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { type: 'error', error: 'No active tab' };

    if (type === 'navigate') {
      await chrome.tabs.update(tab.id, { url: request.url });
      return { type: 'action_result', success: true, action: 'navigate', url: request.url };
    }

    // Inject content script and execute
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    const results = await chrome.tabs.sendMessage(tab.id, request);
    return results;
  } catch (err) {
    return { type: 'error', error: err.message };
  }
}

function updateBadge() {
  if (STATE.active && STATE.agentConnected) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#00c853' });
  } else if (STATE.active) {
    chrome.action.setBadgeText({ text: '•' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff9100' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Restore state on startup
chrome.storage.local.get(['relayActive', 'token', 'permissions', 'auditLog'], (data) => {
  if (data.relayActive) STATE.active = data.relayActive;
  if (data.token) STATE.token = data.token;
  if (data.permissions) STATE.permissions = data.permissions;
  if (data.auditLog) STATE.auditLog = data.auditLog;
  updateBadge();
});
