// Claw Relay — Popup Logic

const relayToggle = document.getElementById('relayToggle');
const activeSection = document.getElementById('activeSection');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const tokenDisplay = document.getElementById('tokenDisplay');
const copyToken = document.getElementById('copyToken');
const revokeBtn = document.getElementById('revokeBtn');
const tabTitle = document.getElementById('tabTitle');
const permInteract = document.getElementById('permInteract');
const permNavigate = document.getElementById('permNavigate');
const permExecute = document.getElementById('permExecute');
const auditLink = document.getElementById('auditLink');

function updateUI(state) {
  relayToggle.checked = state.active;
  activeSection.classList.toggle('hidden', !state.active);

  if (state.active) {
    tokenDisplay.textContent = state.token || '————';
    if (state.agentConnected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Agent connected';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Waiting for agent...';
    }
    permInteract.checked = state.permissions.includes('interact');
    permNavigate.checked = state.permissions.includes('navigate');
    permExecute.checked = state.permissions.includes('execute');
  }
}

// Load state
chrome.runtime.sendMessage({ type: 'get_state' }, updateUI);

// Get current tab info
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab) {
    tabTitle.textContent = tab.title || tab.url;
  }
});

// Toggle relay
relayToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'toggle_relay', active: relayToggle.checked }, updateUI);
});

// Copy token
copyToken.addEventListener('click', () => {
  const token = tokenDisplay.textContent;
  if (token && token !== '————') {
    navigator.clipboard.writeText(token);
    copyToken.textContent = '✅';
    setTimeout(() => copyToken.textContent = '📋', 1500);
  }
});

// Revoke access
revokeBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'revoke_access' }, updateUI);
});

// Permission changes
[permInteract, permNavigate, permExecute].forEach(cb => {
  cb.addEventListener('change', () => {
    const perms = ['read']; // always included
    if (permInteract.checked) perms.push('interact');
    if (permNavigate.checked) perms.push('navigate');
    if (permExecute.checked) perms.push('execute');
    chrome.runtime.sendMessage({ type: 'set_permissions', permissions: perms }, updateUI);
  });
});

// Audit link — open devtools panel (or fallback)
auditLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('panel/panel.html') });
});
