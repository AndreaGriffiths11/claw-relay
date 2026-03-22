const DEFAULTS = {
  relayUrl: 'ws://localhost:9333',
  apiKey: '',
  agentId: 'my-agent'
};

let RELAY_URL = 'http://localhost:9333';
let API_KEY = '';

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const relayUrlDisplay = document.getElementById('relayUrlDisplay');
const agentName = document.getElementById('agentName');
const agentScopes = document.getElementById('agentScopes');
const actionsList = document.getElementById('actionsList');
const toggleBtn = document.getElementById('toggleBtn');

let paused = false;

async function checkRelay() {
  try {
    const headers = {};
    if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
    const resp = await fetch(`${RELAY_URL}/health`, { signal: AbortSignal.timeout(3000), headers });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setConnected(true);
      updateAgent(data);
      updateActions(data.recentActions || []);
    } else {
      setConnected(false);
    }
  } catch {
    setConnected(false);
  }
}

function setConnected(connected) {
  statusDot.className = `dot ${connected ? 'green' : 'red'}`;
  statusText.textContent = connected ? 'Online' : 'Offline';
  if (!connected) {
    agentName.textContent = '—';
    agentScopes.innerHTML = '';
  }
}

function updateAgent(data) {
  if (data.agent) {
    agentName.textContent = data.agent.name || data.agent.id || 'Unknown';
    agentScopes.innerHTML = '';
    (data.agent.scopes || []).forEach(scope => {
      const tag = document.createElement('span');
      tag.className = 'scope-tag';
      tag.textContent = scope;
      agentScopes.appendChild(tag);
    });
  }
}

function updateActions(actions) {
  if (!actions.length) {
    actionsList.innerHTML = '<div class="empty">No actions yet</div>';
    return;
  }
  actionsList.innerHTML = actions.slice(0, 5).map(a => {
    const time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '';
    const ok = a.error ? 'error' : 'ok';
    return `
      <div class="action-item">
        <div>
          <span class="action-type">${a.type || a.action || '?'}</span>
          <span class="action-target">${a.target || ''}</span>
        </div>
        <div class="action-right">
          <span class="action-status ${ok}">${ok === 'ok' ? '✓' : '✗'}</span>
          <span class="action-time">${time}</span>
        </div>
      </div>`;
  }).join('');
}

// Load state
chrome.storage.sync.get(DEFAULTS, (syncResult) => {
  const url = syncResult.relayUrl || DEFAULTS.relayUrl;
  RELAY_URL = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
  API_KEY = syncResult.apiKey || '';
  relayUrlDisplay.textContent = url;

  chrome.storage.local.get(['paused', 'recentActions'], (result) => {
    paused = result.paused || false;
    updateToggle();
    if (result.recentActions) updateActions(result.recentActions);
  });

  checkRelay();
});

// Settings link
document.getElementById('settingsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

toggleBtn.addEventListener('click', () => {
  paused = !paused;
  chrome.storage.local.set({ paused });
  updateToggle();
  // Notify background
  chrome.runtime.sendMessage({ type: 'toggle', paused });
});

function updateToggle() {
  toggleBtn.textContent = paused ? 'Resume Relay' : 'Pause Relay';
  toggleBtn.className = `toggle-btn${paused ? ' paused' : ''}`;
}

// Poll every 5 seconds while popup is open
setInterval(checkRelay, 5000);
