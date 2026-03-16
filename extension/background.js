const RELAY_URL = 'http://localhost:9333';
const CHECK_INTERVAL = 30000;

async function checkHealth() {
  try {
    const resp = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(5000) });
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

// Listen for toggle from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle') {
    if (msg.paused) {
      chrome.action.setBadgeText({ text: '⏸' });
      chrome.action.setBadgeBackgroundColor({ color: '#d29922' });
    } else {
      checkHealth();
    }
  }
});

// Initial check + periodic
checkHealth();
setInterval(checkHealth, CHECK_INTERVAL);
