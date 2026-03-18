import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { Config, AgentConfig, loadConfig } from './auth';
import { AgentState } from './state';

type GetStateFn = () => { connections: AgentState[]; startedAt: string };

function getAdminToken(config: Config): string {
  return config.dashboard.adminToken;
}

function checkAuth(config: Config, req: Request): boolean {
  const authHeader = req.headers.get('authorization');
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

const VALID_SCOPES = ['navigate', 'read', 'interact', 'evaluate'];
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateAgentFields(body: any, requireIdToken: boolean): string | null {
  if (requireIdToken) {
    if (typeof body.id !== 'string' || !AGENT_ID_RE.test(body.id))
      return 'id must be alphanumeric/hyphens/underscores, 1-64 chars';
    if (typeof body.token !== 'string' || body.token.length < 8)
      return 'token must be a string of at least 8 characters';
  } else {
    if (body.token !== undefined && (typeof body.token !== 'string' || body.token.length < 8))
      return 'token must be a string of at least 8 characters';
  }
  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || !body.scopes.every((s: any) => typeof s === 'string' && VALID_SCOPES.includes(s)))
      return 'scopes must be an array of: ' + VALID_SCOPES.join(', ');
  }
  if (body.allowlist !== undefined) {
    if (!Array.isArray(body.allowlist) || !body.allowlist.every((s: any) => typeof s === 'string'))
      return 'allowlist must be an array of strings';
  }
  if (body.rateLimit !== undefined) {
    if (typeof body.rateLimit !== 'number' || !Number.isInteger(body.rateLimit) || body.rateLimit <= 0)
      return 'rateLimit must be a positive integer';
  }
  return null;
}

// Resolve the dashboard dist directory
const DASHBOARD_DIST = path.join(import.meta.dir, '..', 'dashboard', 'dist');

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return types[ext] || 'application/octet-stream';
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

  if (!config.dashboard.adminToken) {
    console.warn('Dashboard disabled: no adminToken configured');
  }

  const app = new Hono();

  // Health endpoint (no auth required)
  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // Auth middleware for API routes
  const requireAuth = (c: any, next: any) => {
    if (!config.dashboard.adminToken) {
      return c.json({ error: 'Dashboard disabled: no adminToken configured' }, 403);
    }
    if (!checkAuth(config, c.req.raw)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };

  // API routes
  app.use('/api/*', requireAuth);

  app.get('/api/config', (c) => {
    const redacted: Record<string, any> = {};
    for (const [id, agent] of Object.entries(config.agents)) {
      redacted[id] = { ...agent, token: redactToken(agent.token) };
    }
    return c.json({ agents: redacted, server: config.server, dashboard: { port: config.dashboard.port } });
  });

  app.get('/api/status', (c) => {
    const state = getState();
    return c.json(state);
  });

  app.get('/api/audit', (c) => {
    const entries = readAuditLog(config);
    return c.json({ entries });
  });

  app.delete('/api/audit', (c) => {
    const logFile = config.audit.logFile;
    const absPath = path.isAbsolute(logFile) ? logFile : path.join(process.cwd(), logFile);
    try { fs.writeFileSync(absPath, '', 'utf-8'); } catch {}
    return c.json({ ok: true });
  });

  app.get('/api/audit/download', (c) => {
    const entries = readAuditLog(config);
    return new Response(JSON.stringify(entries, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="claw-relay-audit-' + new Date().toISOString().slice(0,10) + '.json"',
      },
    });
  });

  app.post('/api/agents', async (c) => {
    try {
      const body = await c.req.json();
      const { id, token, scopes, allowlist, rateLimit } = body;
      const err = validateAgentFields(body, true);
      if (err) return c.json({ error: err }, 400);
      if (config.agents[id]) return c.json({ error: 'Agent already exists' }, 409);
      config.agents[id] = {
        token,
        scopes: scopes || ['read'],
        allowlist: allowlist || ['*'],
        rateLimit: rateLimit || 30,
      };
      writeConfigAtomic(configPath, config);
      reloadCfg();
      return c.json({ ok: true }, 201);
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.put('/api/agents/:id', async (c) => {
    const id = c.req.param('id');
    if (!config.agents[id]) return c.json({ error: 'Agent not found' }, 404);
    try {
      const body = await c.req.json();
      const err = validateAgentFields(body, false);
      if (err) return c.json({ error: err }, 400);
      if (body.scopes !== undefined) config.agents[id].scopes = body.scopes;
      if (body.allowlist !== undefined) config.agents[id].allowlist = body.allowlist;
      if (body.rateLimit !== undefined) config.agents[id].rateLimit = body.rateLimit;
      if (body.token !== undefined) config.agents[id].token = body.token;
      writeConfigAtomic(configPath, config);
      reloadCfg();
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.delete('/api/agents/:id', (c) => {
    const id = c.req.param('id');
    if (!config.agents[id]) return c.json({ error: 'Agent not found' }, 404);
    delete config.agents[id];
    writeConfigAtomic(configPath, config);
    reloadCfg();
    return c.json({ ok: true });
  });

  // Serve SPA static files
  const hasDist = fs.existsSync(DASHBOARD_DIST);

  if (hasDist) {
    // Serve static assets from dist/assets/
    app.get('/assets/*', (c) => {
      const filePath = path.join(DASHBOARD_DIST, c.req.path);
      try {
        const file = Bun.file(filePath);
        return new Response(file, {
          headers: {
            'Content-Type': getMimeType(filePath),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (c) => {
      const indexPath = path.join(DASHBOARD_DIST, 'index.html');
      try {
        const file = Bun.file(indexPath);
        return new Response(file, {
          headers: { 'Content-Type': 'text/html' },
        });
      } catch {
        return c.notFound();
      }
    });
  } else {
    app.get('*', (c) => {
      return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#faf9f7">
        <div style="text-align:center"><h1>🦞 Dashboard Not Built</h1><p style="color:#666;margin-top:8px">Run <code>cd relay-server/dashboard && bun run build</code> to build the dashboard.</p></div>
      </body></html>`);
    });
  }

  Bun.serve({
    port: config.dashboard.port,
    fetch: app.fetch,
  });

  console.log(`Dashboard running on http://localhost:${config.dashboard.port}`);
}
