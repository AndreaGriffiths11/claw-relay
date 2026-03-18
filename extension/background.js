const DEFAULTS = {
  relayUrl: 'ws://localhost:9333',
  apiKey: '',
  agentId: 'my-agent'
};
const CHECK_INTERVAL = 30000;

let currentSettings = { ...DEFAULTS };

function getHealthUrl() {
  // Convert ws(s):// to http(s):// for health endpoint
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
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#39d353' });
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
  chrome.action.setBadgeText({ text: 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff7b72' });
  chrome.storage.local.set({ connected: false, lastCheck: Date.now() });
}

function loadSettingsAndCheck() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    currentSettings = items;
    checkHealth();
  });
}

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((msg) => {
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
});

// Initial load + periodic
loadSettingsAndCheck();
setInterval(() => loadSettingsAndCheck(), CHECK_INTERVAL);
