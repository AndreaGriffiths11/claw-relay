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
  const adminToken = getAdminToken(config);
  const isBearerAuth = authHeader?.startsWith('Bearer ');
  if (!isBearerAuth) return false;
  const providedToken = authHeader!.slice(7);
  const tokenMatches = providedToken === adminToken;
  return tokenMatches;
}

function redactToken(token: string): string {
  const isTooShort = token.length <= 4;
  if (isTooShort) return '****';
  const lastFourChars = token.slice(-4);
  return '****' + lastFourChars;
}

function readAuditLog(config: Config): any[] {
  const logFile = config.audit.logFile;
  const isAbsolute = path.isAbsolute(logFile);
  const absPath = isAbsolute ? logFile : path.join(process.cwd(), logFile);
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const allLines = content.trim().split('\n').filter(Boolean);
    const recentLines = allLines.slice(-100);
    const parsedEntries = recentLines.map(l => { try { return JSON.parse(l); } catch { return null; } });
    const validEntries = parsedEntries.filter(Boolean);
    return validEntries;
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
  const tmpSuffix = '.tmp.' + Date.now();
  const tmp = configPath + tmpSuffix;
  fs.writeFileSync(tmp, yamlStr, 'utf-8');
  fs.renameSync(tmp, configPath);
}

const VALID_SCOPES = ['navigate', 'read', 'interact', 'evaluate'];
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateAgentFields(body: any, requireIdToken: boolean): string | null {
  if (requireIdToken) {
    const idIsString = typeof body.id === 'string';
    const idMatchesPattern = idIsString && AGENT_ID_RE.test(body.id);
    if (!idMatchesPattern)
      return 'id must be alphanumeric/hyphens/underscores, 1-64 chars';
    const tokenIsString = typeof body.token === 'string';
    const tokenLongEnough = tokenIsString && body.token.length >= 8;
    if (!tokenLongEnough)
      return 'token must be a string of at least 8 characters';
  } else {
    if (body.token !== undefined) {
      const tokenIsString = typeof body.token === 'string';
      const tokenLongEnough = tokenIsString && body.token.length >= 8;
      if (!tokenLongEnough)
        return 'token must be a string of at least 8 characters';
    }
  }
  if (body.scopes !== undefined) {
    const scopesIsArray = Array.isArray(body.scopes);
    const allScopesValid = scopesIsArray && body.scopes.every((s: any) => typeof s === 'string' && VALID_SCOPES.includes(s));
    if (!allScopesValid)
      return 'scopes must be an array of: ' + VALID_SCOPES.join(', ');
  }
  if (body.allowlist !== undefined) {
    const allowlistIsArray = Array.isArray(body.allowlist);
    const allStrings = allowlistIsArray && body.allowlist.every((s: any) => typeof s === 'string');
    if (!allStrings)
      return 'allowlist must be an array of strings';
  }
  if (body.rateLimit !== undefined) {
    const isNumber = typeof body.rateLimit === 'number';
    const isPositiveInteger = isNumber && Number.isInteger(body.rateLimit) && body.rateLimit > 0;
    if (!isPositiveInteger)
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
    const isAbsolute = path.isAbsolute(logFile);
    const absPath = isAbsolute ? logFile : path.join(process.cwd(), logFile);
    try { fs.writeFileSync(absPath, '', 'utf-8'); } catch {}
    return c.json({ ok: true });
  });

  app.get('/api/audit/download', (c) => {
    const entries = readAuditLog(config);
    const formattedJson = JSON.stringify(entries, null, 2);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = 'claw-relay-audit-' + dateStamp + '.json';
    return new Response(formattedJson, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
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
