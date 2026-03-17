import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { Config, AgentConfig, loadConfig } from './auth';
import { AgentState } from './state';

type GetStateFn = () => { connections: AgentState[]; startedAt: string };

function getAdminToken(config: Config): string {
  return config.dashboard.adminToken;
}

function checkAuth(config: Config, req: http.IncomingMessage): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === getAdminToken(config)) return true;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === getAdminToken(config)) return true;
  return false;
}

function redactToken(token: string): string {
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

function readAuditLog(config: Config): any[] {
  const logFile = config.audit.logFile;
  const absPath = path.isAbsolute(logFile) ? logFile : path.join(process.cwd(), logFile);
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-100).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function writeConfigAtomic(configPath: string, config: Config): void {
  const data: any = {
    server: config.server,
    agents: config.agents,
    blocklist: config.blocklist,
    audit: config.audit,
    engine: config.engine,
    dashboard: config.dashboard,
  };
  const yamlStr = YAML.stringify(data);
  const tmp = configPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, yamlStr, 'utf-8');
  fs.renameSync(tmp, configPath);
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

export function startDashboard(
  initialConfig: Config,
  getState: GetStateFn,
  configPath: string,
  onConfigChange: () => void,
): void {
  let config = initialConfig;

  const reloadCfg = () => {
    config = loadConfig(configPath);
    onConfigChange();
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    // Serve dashboard HTML
    if (pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML());
      return;
    }

    // API routes require auth
    if (pathname.startsWith('/api/')) {
      if (!checkAuth(config, req)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      // GET /api/config
      if (pathname === '/api/config' && method === 'GET') {
        const redacted: Record<string, any> = {};
        for (const [id, agent] of Object.entries(config.agents)) {
          redacted[id] = { ...agent, token: redactToken(agent.token), _fullToken: agent.token };
        }
        json(res, 200, { agents: redacted, server: config.server, dashboard: { port: config.dashboard.port } });
        return;
      }

      // GET /api/status
      if (pathname === '/api/status' && method === 'GET') {
        const state = getState();
        json(res, 200, state);
        return;
      }

      // GET /api/audit
      if (pathname === '/api/audit' && method === 'GET') {
        const entries = readAuditLog(config);
        json(res, 200, { entries });
        return;
      }

      // POST /api/agents
      if (pathname === '/api/agents' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const { id, token, scopes, allowlist, rateLimit } = body;
          if (!id || !token) { json(res, 400, { error: 'id and token required' }); return; }
          if (config.agents[id]) { json(res, 409, { error: 'Agent already exists' }); return; }
          config.agents[id] = {
            token,
            scopes: scopes || ['read'],
            allowlist: allowlist || ['*'],
            rateLimit: rateLimit || 30,
          };
          writeConfigAtomic(configPath, config);
          reloadCfg();
          json(res, 201, { ok: true });
        } catch (e: any) {
          json(res, 400, { error: e.message });
        }
        return;
      }

      // PUT /api/agents/:id
      const putMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (putMatch && method === 'PUT') {
        const id = decodeURIComponent(putMatch[1]);
        if (!config.agents[id]) { json(res, 404, { error: 'Agent not found' }); return; }
        try {
          const body = await parseBody(req);
          if (body.scopes !== undefined) config.agents[id].scopes = body.scopes;
          if (body.allowlist !== undefined) config.agents[id].allowlist = body.allowlist;
          if (body.rateLimit !== undefined) config.agents[id].rateLimit = body.rateLimit;
          if (body.token !== undefined) config.agents[id].token = body.token;
          writeConfigAtomic(configPath, config);
          reloadCfg();
          json(res, 200, { ok: true });
        } catch (e: any) {
          json(res, 400, { error: e.message });
        }
        return;
      }

      // DELETE /api/agents/:id
      const delMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (delMatch && method === 'DELETE') {
        const id = decodeURIComponent(delMatch[1]);
        if (!config.agents[id]) { json(res, 404, { error: 'Agent not found' }); return; }
        delete config.agents[id];
        writeConfigAtomic(configPath, config);
        reloadCfg();
        json(res, 200, { ok: true });
        return;
      }

      json(res, 404, { error: 'Not found' });
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  server.listen(config.dashboard.port, () => {
    console.log(`Dashboard running on http://localhost:${config.dashboard.port}`);
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claw Relay Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:#faf9f7;color:#1a1a1a;min-height:100vh}
h1,h2,h3{font-family:'Instrument Serif',serif;font-weight:400}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 32px;background:#fff;border-bottom:1px solid #eee}
.topbar h1{font-size:24px}
.status-badge{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500;color:#16a34a}
.status-dot{width:10px;height:10px;border-radius:50%;background:#16a34a;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.container{max-width:1200px;margin:0 auto;padding:24px}
.stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:32px}
.card{background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.06);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-3px);box-shadow:0 2px 8px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1)}
.stat-card{text-align:center}
.stat-card .value{font-size:36px;font-weight:700;color:#e53935}
.stat-card .label{font-size:14px;color:#666;margin-top:4px}
.section-title{font-size:28px;margin-bottom:16px}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;margin-bottom:32px}
.agent-card .agent-id{font-size:18px;font-weight:700;margin-bottom:8px}
.agent-card .status{font-size:13px;margin-bottom:8px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.pill{padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500;color:#fff}
.pill-read{background:#3b82f6}.pill-interact{background:#16a34a}.pill-navigate{background:#f97316}.pill-execute{background:#e53935}
.meta{font-size:13px;color:#888;margin-bottom:4px}
.token-row{display:flex;align-items:center;gap:8px}
.token-val{font-family:monospace;font-size:13px;background:#f5f5f5;padding:2px 8px;border-radius:6px}
.btn{padding:8px 16px;border-radius:12px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;transition:all .15s}
.btn-sm{padding:5px 12px;font-size:12px}
.btn-red{background:#e53935;color:#fff}.btn-red:hover{background:#c62828}
.btn-green{background:#16a34a;color:#fff}.btn-green:hover{background:#15803d}
.btn-outline{background:transparent;border:1.5px solid #ddd;color:#1a1a1a}.btn-outline:hover{border-color:#e53935;color:#e53935}
.btn-copy{background:#f0f0f0;color:#555;padding:4px 10px;font-size:11px;border-radius:8px}
.actions{display:flex;gap:8px;margin-top:12px}
#add-form-wrap{max-height:0;overflow:hidden;transition:max-height .3s;margin-bottom:24px}
#add-form-wrap.open{max-height:600px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-grid label{font-size:13px;font-weight:600;display:block;margin-bottom:4px}
.form-grid input,.form-grid textarea{width:100%;padding:10px;border:1.5px solid #ddd;border-radius:12px;font-family:'DM Sans',sans-serif;font-size:14px}
.form-grid textarea{resize:vertical;min-height:60px}
.scopes-checks{display:flex;gap:16px;align-items:center;padding-top:8px}
.scopes-checks label{font-weight:400;display:flex;align-items:center;gap:4px}
.full-width{grid-column:1/-1}
.audit-wrap{max-height:400px;overflow-y:auto;border-radius:16px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.06)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 14px;background:#faf9f7;font-weight:600;position:sticky;top:0}
td{padding:8px 14px;border-top:1px solid #f0f0f0}
tr.ok td{background:#f0fdf4}
tr.fail td{background:#fef2f2}
.hidden{display:none !important}
#auth-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000}
#auth-modal .modal{background:#fff;border-radius:20px;padding:32px;max-width:400px;width:90%;text-align:center}
#auth-modal input{width:100%;padding:12px;border:1.5px solid #ddd;border-radius:12px;margin:16px 0;font-size:16px;font-family:'DM Sans',sans-serif}
</style>
</head>
<body>
<div class="topbar">
  <h1>🦞 Claw Relay Dashboard</h1>
  <div class="status-badge"><div class="status-dot"></div> Running</div>
</div>
<div class="container">
  <div class="stats-row">
    <div class="card stat-card"><div class="value" id="stat-agents">—</div><div class="label">Connected Agents</div></div>
    <div class="card stat-card"><div class="value" id="stat-actions">—</div><div class="label">Total Actions</div></div>
    <div class="card stat-card"><div class="value" id="stat-uptime">—</div><div class="label">Uptime</div></div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
    <h2 class="section-title" style="margin-bottom:0">Agents</h2>
    <button class="btn btn-green" onclick="toggleAddForm()">+ Add Agent</button>
  </div>
  <div id="add-form-wrap">
    <div class="card">
      <div class="form-grid">
        <div><label>Agent ID</label><input id="f-id" placeholder="my-agent"></div>
        <div><label>Token <button class="btn btn-copy" onclick="autoGenToken()">Auto-generate</button></label><input id="f-token" placeholder="secret-token"></div>
        <div class="full-width"><label>Scopes</label><div class="scopes-checks">
          <label><input type="checkbox" value="read" checked> read</label>
          <label><input type="checkbox" value="interact"> interact</label>
          <label><input type="checkbox" value="navigate"> navigate</label>
          <label><input type="checkbox" value="execute"> execute</label>
        </div></div>
        <div><label>Allowlist (one per line)</label><textarea id="f-allowlist" placeholder="*">*</textarea></div>
        <div><label>Rate Limit (req/min)</label><input id="f-rate" type="number" value="30"></div>
        <div class="full-width" style="text-align:right;padding-top:8px">
          <button class="btn btn-outline" onclick="toggleAddForm()">Cancel</button>
          <button class="btn btn-green" onclick="addAgent()" style="margin-left:8px">Create Agent</button>
        </div>
      </div>
    </div>
  </div>
  <div id="agents-grid" class="agent-grid"></div>
  <h2 class="section-title">Audit Log</h2>
  <div class="audit-wrap"><table><thead><tr><th>Time</th><th>Agent</th><th>Action</th><th>Target</th><th>Status</th><th>Duration</th></tr></thead><tbody id="audit-body"></tbody></table></div>
</div>
<div id="auth-modal" class="hidden">
  <div class="modal">
    <h2>🦞 Dashboard Auth</h2>
    <p style="color:#666;margin-top:8px">Enter admin token to continue</p>
    <input id="token-input" type="password" placeholder="Admin token">
    <button class="btn btn-red" onclick="saveToken()" style="width:100%">Authenticate</button>
  </div>
</div>
<script>
let TOKEN = localStorage.getItem('claw-dashboard-token') || '';
let configData = {};
if (!TOKEN) document.getElementById('auth-modal').classList.remove('hidden');

function saveToken() {
  TOKEN = document.getElementById('token-input').value.trim();
  if (!TOKEN) return;
  localStorage.setItem('claw-dashboard-token', TOKEN);
  api('/api/status').then(() => {
    document.getElementById('auth-modal').classList.add('hidden');
    refresh();
  }).catch(() => {
    TOKEN = '';
    localStorage.removeItem('claw-dashboard-token');
    alert('Invalid token');
  });
}

function api(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(path + sep + 'token=' + encodeURIComponent(TOKEN), opts).then(r => {
    if (r.status === 401) { localStorage.removeItem('claw-dashboard-token'); document.getElementById('auth-modal').classList.remove('hidden'); throw new Error('Unauthorized'); }
    return r.json();
  });
}

function formatUptime(started) {
  const ms = Date.now() - new Date(started).getTime();
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
  if (d > 0) return d + 'd ' + (h%24) + 'h';
  if (h > 0) return h + 'h ' + (m%60) + 'm';
  return m + 'm ' + (s%60) + 's';
}

function pillClass(scope) {
  return 'pill pill-' + scope;
}

async function refresh() {
  if (!TOKEN) return;
  try {
    const [status, cfg] = await Promise.all([api('/api/status'), api('/api/config')]);
    configData = cfg;
    const connMap = {};
    let totalActions = 0;
    (status.connections||[]).forEach(c => { connMap[c.agentId] = c; totalActions += c.actionCount; });
    document.getElementById('stat-agents').textContent = status.connections?.length || 0;
    document.getElementById('stat-actions').textContent = totalActions;
    document.getElementById('stat-uptime').textContent = formatUptime(status.startedAt);
    const grid = document.getElementById('agents-grid');
    grid.innerHTML = '';
    for (const [id, agent] of Object.entries(cfg.agents)) {
      const conn = connMap[id];
      const card = document.createElement('div');
      card.className = 'card agent-card';
      const statusEmoji = conn ? '🟢 Connected' : '⚪ Offline';
      const scopePills = (agent.scopes||[]).map(s => '<span class="' + pillClass(s) + '">' + s + '</span>').join('');
      const lastAct = conn && conn.lastAction ? conn.lastAction + ' (' + new Date(conn.lastActionAt).toLocaleTimeString() + ')' : '—';
      card.innerHTML = '<div class="agent-id">' + id + '</div>' +
        '<div class="status">' + statusEmoji + '</div>' +
        '<div class="pills">' + scopePills + '</div>' +
        '<div class="meta">Allowlist: ' + (agent.allowlist||[]).join(', ') + '</div>' +
        '<div class="meta">Rate limit: ' + agent.rateLimit + '/min</div>' +
        '<div class="meta token-row">Token: <span class="token-val">' + agent.token + '</span> <button class="btn btn-copy" onclick="copyToken(\\'' + id + '\\')">Copy</button></div>' +
        '<div class="meta">Last action: ' + lastAct + '</div>' +
        '<div class="actions"><button class="btn btn-sm btn-outline" onclick="editAgent(\\'' + id + '\\')">Edit</button><button class="btn btn-sm btn-red" onclick="deleteAgent(\\'' + id + '\\')">Delete</button></div>';
      grid.appendChild(card);
    }
  } catch(e) { console.error(e); }
}

async function refreshAudit() {
  if (!TOKEN) return;
  try {
    const data = await api('/api/audit');
    const tbody = document.getElementById('audit-body');
    tbody.innerHTML = (data.entries||[]).reverse().map(e => {
      const cls = e.ok ? 'ok' : 'fail';
      const t = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—';
      return '<tr class="' + cls + '"><td>' + t + '</td><td>' + (e.agent_id||'—') + '</td><td>' + (e.action||'—') + '</td><td>' + (e.target||'—') + '</td><td>' + (e.ok ? '✓' : '✗') + '</td><td>' + (e.duration_ms != null ? e.duration_ms + 'ms' : '—') + '</td></tr>';
    }).join('');
  } catch(e) {}
}

function toggleAddForm() {
  document.getElementById('add-form-wrap').classList.toggle('open');
}

function autoGenToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  document.getElementById('f-token').value = Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
}

async function addAgent() {
  const id = document.getElementById('f-id').value.trim();
  const token = document.getElementById('f-token').value.trim();
  if (!id || !token) return alert('ID and token required');
  const scopes = Array.from(document.querySelectorAll('.scopes-checks input:checked')).map(cb => cb.value);
  const allowlist = document.getElementById('f-allowlist').value.trim().split('\\n').filter(Boolean);
  const rateLimit = parseInt(document.getElementById('f-rate').value) || 30;
  await api('/api/agents', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id,token,scopes,allowlist,rateLimit}) });
  toggleAddForm();
  refresh();
}

function copyToken(id) {
  const agent = configData.agents?.[id];
  if (agent?._fullToken) navigator.clipboard.writeText(agent._fullToken);
}

async function deleteAgent(id) {
  if (!confirm('Delete agent ' + id + '?')) return;
  await api('/api/agents/' + encodeURIComponent(id), { method: 'DELETE' });
  refresh();
}

async function editAgent(id) {
  const agent = configData.agents?.[id];
  if (!agent) return;
  const newRate = prompt('Rate limit (current: ' + agent.rateLimit + '):', agent.rateLimit);
  if (newRate === null) return;
  await api('/api/agents/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ rateLimit: parseInt(newRate) || agent.rateLimit })
  });
  refresh();
}

if (TOKEN) { refresh(); refreshAudit(); }
setInterval(refresh, 5000);
setInterval(refreshAudit, 10000);
</script>
</body>
</html>`;
}
