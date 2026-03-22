const DEFAULTS = {
  relayUrl: 'ws://localhost:9333',
  apiKey: '',
  agentId: 'my-agent'
};

const relayUrlInput = document.getElementById('relayUrl');
const apiKeyInput = document.getElementById('apiKey');
const agentIdInput = document.getElementById('agentId');
const saveBtn = document.getElementById('saveBtn');
const status = document.getElementById('status');

// Load saved settings
chrome.storage.sync.get(DEFAULTS, (items) => {
  relayUrlInput.value = items.relayUrl === DEFAULTS.relayUrl ? '' : items.relayUrl;
  apiKeyInput.value = items.apiKey;
  agentIdInput.value = items.agentId === DEFAULTS.agentId ? '' : items.agentId;
});

saveBtn.addEventListener('click', () => {
  const settings = {
    relayUrl: relayUrlInput.value.trim() || DEFAULTS.relayUrl,
    apiKey: apiKeyInput.value,
    agentId: agentIdInput.value.trim() || DEFAULTS.agentId
  };

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      showStatus('Error saving', 'error');
    } else {
      showStatus('Saved ✓', 'saved');
      // Notify background to reconnect with new settings
      chrome.runtime.sendMessage({ type: 'settingsChanged', settings });
    }
  });
});

function showStatus(text, cls) {
  status.textContent = text;
  status.className = `show ${cls}`;
  setTimeout(() => { status.className = ''; }, 2500);
}
