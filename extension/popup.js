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

// Bridge elements
const bridgeDot = document.getElementById('bridgeDot');
const bridgeStatus = document.getElementById('bridgeStatus');
const bridgeConnectBtn = document.getElementById('bridgeConnectBtn');
const attachBtn = document.getElementById('attachBtn');
const attachedTabsList = document.getElementById('attachedTabsList');

let paused = false;
let currentTabId = null;
let bridgeState = { attachedTabs: [], wsConnected: false };

// ── Get current tab ───────────────────────────────────────
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Relay health check (original) ─────────────────────────
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

// ── Bridge UI ─────────────────────────────────────────────
function updateBridgeUI() {
  // WS status
  bridgeDot.className = `dot ${bridgeState.wsConnected ? 'blue' : 'red'}`;
  bridgeStatus.textContent = bridgeState.wsConnected ? 'Bridge Connected' : 'Disconnected';
  bridgeConnectBtn.textContent = bridgeState.wsConnected ? 'Disconnect' : 'Connect';
  if (bridgeState.wsConnected) {
    bridgeConnectBtn.classList.add('danger');
  } else {
    bridgeConnectBtn.classList.remove('danger');
  }

  // Attach button
  const isAttached = currentTabId && bridgeState.attachedTabs.includes(currentTabId);
  if (isAttached) {
    attachBtn.textContent = '🔓 Detach This Tab';
    attachBtn.classList.add('detach');
  } else {
    attachBtn.textContent = '🔗 Attach This Tab';
    attachBtn.classList.remove('detach');
  }

  // Attached tabs list
  if (bridgeState.attachedTabs.length === 0) {
    attachedTabsList.innerHTML = '';
    return;
  }

  // Fetch tab info for attached tabs
  Promise.all(bridgeState.attachedTabs.map(tabId =>
    chrome.tabs.get(tabId).catch(() => null)
  )).then(tabs => {
    attachedTabsList.innerHTML = '';
    tabs.forEach((tab, i) => {
      if (!tab) return;
      const li = document.createElement('li');
      li.className = 'tab-item';
      li.innerHTML = `
        <div class="tab-info">
          ${tab.favIconUrl ? `<img class="tab-favicon" src="${tab.favIconUrl}" alt="">` : '<span class="tab-favicon">🌐</span>'}
          <span class="tab-title" title="${tab.title || ''}">${tab.title || 'Untitled'}</span>
        </div>
        <button class="tab-detach-btn" data-tab-id="${tab.id}">✕</button>
      `;
      attachedTabsList.appendChild(li);
    });

    // Detach buttons
    attachedTabsList.querySelectorAll('.tab-detach-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = parseInt(btn.dataset.tabId, 10);
        chrome.runtime.sendMessage({ type: 'detach-tab', tabId }, () => {
          refreshBridgeState();
        });
      });
    });
  });
}

function refreshBridgeState() {
  chrome.runtime.sendMessage({ type: 'get-bridge-state' }, (response) => {
    if (response) {
      bridgeState = response;
      updateBridgeUI();
    }
  });
}

// ── Bridge event listeners ────────────────────────────────
bridgeConnectBtn.addEventListener('click', () => {
  if (bridgeState.wsConnected) {
    chrome.runtime.sendMessage({ type: 'disconnect-bridge' }, () => {
      refreshBridgeState();
    });
  } else {
    chrome.runtime.sendMessage({ type: 'connect-bridge' }, () => {
      setTimeout(refreshBridgeState, 500);
    });
  }
});

attachBtn.addEventListener('click', async () => {
  if (!currentTabId) return;
  const isAttached = bridgeState.attachedTabs.includes(currentTabId);
  const msgType = isAttached ? 'detach-tab' : 'attach-tab';
  chrome.runtime.sendMessage({ type: msgType, tabId: currentTabId }, (response) => {
    if (response?.error) {
      console.error('Bridge error:', response.error);
    }
    refreshBridgeState();
  });
});

// Listen for state broadcasts from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'bridge-state') {
    bridgeState = {
      attachedTabs: msg.attachedTabs || [],
      wsConnected: msg.wsConnected || false
    };
    updateBridgeUI();
  }
});

// ── Init ──────────────────────────────────────────────────
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

// Get current tab and init bridge UI
getCurrentTab().then(tab => {
  if (tab) currentTabId = tab.id;
  refreshBridgeState();
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
  chrome.runtime.sendMessage({ type: 'toggle', paused });
});

function updateToggle() {
  toggleBtn.textContent = paused ? 'Resume Relay' : 'Pause Relay';
  toggleBtn.className = `toggle-btn${paused ? ' paused' : ''}`;
}

// Poll while popup open
setInterval(checkRelay, 5000);
setInterval(refreshBridgeState, 3000);
