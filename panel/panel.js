const logBody = document.getElementById('logBody');
const emptyState = document.getElementById('emptyState');
const clearBtn = document.getElementById('clearBtn');

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function renderLog(log) {
  if (!log.length) {
    emptyState.style.display = 'block';
    logBody.innerHTML = '';
    return;
  }
  emptyState.style.display = 'none';
  logBody.innerHTML = log.map(e => `
    <div class="log-row">
      <span class="col-time">${formatTime(e.timestamp)}</span>
      <span class="col-action">${e.action}</span>
      <span class="col-detail" title="${(e.detail || '').replace(/"/g, '&quot;')}">${e.detail || ''}</span>
    </div>
  `).reverse().join('');
}

// Load initial log
chrome.runtime.sendMessage({ type: 'get_audit_log' }, (res) => {
  renderLog(res?.log || []);
});

// Listen for updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'audit_update') {
    chrome.runtime.sendMessage({ type: 'get_audit_log' }, (res) => {
      renderLog(res?.log || []);
    });
  }
});

clearBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear_audit_log' }, () => {
    renderLog([]);
  });
});
