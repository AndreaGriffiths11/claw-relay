const toggleBtn = document.getElementById('toggleBtn');
const indicator = document.getElementById('indicator');
const statusText = document.getElementById('statusText');
const agentName = document.getElementById('agentName');
const currentUrl = document.getElementById('currentUrl');
const actionList = document.getElementById('actionList');

function updateUI(state) {
  const on = state.enabled;
  toggleBtn.textContent = on ? 'Disable Relay' : 'Enable Relay';
  toggleBtn.className = 'toggle ' + (on ? 'on' : 'off');
  indicator.className = 'indicator ' + (on ? 'on' : 'off');
  statusText.textContent = on ? (state.agent ? `Agent: ${state.agent}` : 'Connected') : 'Disconnected';
  agentName.textContent = state.agent || '—';
  currentUrl.textContent = state.url || '—';

  if (state.actions && state.actions.length) {
    actionList.innerHTML = state.actions.slice(-5).reverse()
      .map(a => `<div class="action-item">${a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : ''} ${a.action} ${a.target || ''} ${a.ok ? '✓' : '✗'}</div>`)
      .join('');
  }
}

chrome.storage.local.get(['relayState'], (result) => {
  updateUI(result.relayState || { enabled: false });
});

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['relayState'], (result) => {
    const state = result.relayState || { enabled: false };
    state.enabled = !state.enabled;
    chrome.storage.local.set({ relayState: state });
    chrome.runtime.sendMessage({ type: 'toggle', enabled: state.enabled });
    updateUI(state);
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.relayState) updateUI(changes.relayState.newValue);
});
