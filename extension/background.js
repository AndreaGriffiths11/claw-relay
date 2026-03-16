// Claw Relay background service worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'toggle') {
    console.log(`Relay ${msg.enabled ? 'enabled' : 'disabled'}`);
    if (msg.enabled) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#00e676' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }
  sendResponse({ ok: true });
});

// Update current tab URL in state
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      chrome.storage.local.get(['relayState'], (result) => {
        const state = result.relayState || { enabled: false };
        state.url = tab.url;
        chrome.storage.local.set({ relayState: state });
      });
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.storage.local.get(['relayState'], (result) => {
      const state = result.relayState || { enabled: false };
      state.url = changeInfo.url;
      chrome.storage.local.set({ relayState: state });
    });
  }
});

console.log('Claw Relay service worker started');
