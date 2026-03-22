import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { Context } from 'hono';
import type { MiddlewareHandler, Next } from 'hono/types';
import { Config, AgentConfig, loadConfig } from './auth';
import { AgentState } from './state';
import { tailLines } from './audit-logger';

/** Shape of the request body for agent CRUD operations */
interface AgentRequestBody {
  id?: string;
  token?: string;
  scopes?: string[];
  allowlist?: string[];
  rateLimit?: number;
}

/** A single audit log entry (parsed from JSONL) */
interface AuditEntry {
  agent_id?: string;
  action?: string;
  ok?: boolean;
  duration_ms?: number;
  error?: string;
  target?: string;
  timestamp?: string;
}

/** Config data written to YAML (mirrors Config but used for serialization) */
interface ConfigData {
  server: Config['server'];
  agents: Config['agents'];
  blocklist: Config['blocklist'];
  audit: Config['audit'];
  engine: Config['engine'];
  dashboard: Config['dashboard'];
}

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
  const providedHash = crypto.createHash('sha256').update(providedToken).digest();
  const adminHash = crypto.createHash('sha256').update(adminToken).digest();
  return crypto.timingSafeEqual(providedHash, adminHash);
}

function redactToken(token: string): string {
  const isTooShort = token.length <= 4;
  if (isTooShort) return '****';
  const lastFourChars = token.slice(-4);
  return '****' + lastFourChars;
}

function readAuditLog(config: Config, limit: number = 200): AuditEntry[] {
  const logFile = config.audit.logFile;
  const isAbsolute = path.isAbsolute(logFile);
  const absPath = isAbsolute ? logFile : path.join(process.cwd(), logFile);
  const lines = tailLines(absPath, limit);
  const parsedEntries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
  return parsedEntries.filter(Boolean) as AuditEntry[];
}

function writeConfigAtomic(configPath: string, config: Config): void {
  const data: ConfigData = {
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

const VALID_SCOPES = ['navigate', 'read', 'interact', 'execute'];
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateAgentFields(body: AgentRequestBody, requireIdToken: boolean): string | null {
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
    const allScopesValid = scopesIsArray && body.scopes!.every((s: string) => typeof s === 'string' && VALID_SCOPES.includes(s));
    if (!allScopesValid)
      return 'scopes must be an array of: ' + VALID_SCOPES.join(', ');
  }
  if (body.allowlist !== undefined) {
    const allowlistIsArray = Array.isArray(body.allowlist);
    const allStrings = allowlistIsArray && body.allowlist!.every((s: string) => typeof s === 'string');
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

  // CORS — dashboard is local, restrict to localhost origins
  app.use('*', cors({
    origin: ['http://localhost:9334', 'http://127.0.0.1:9334'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));

  // Health endpoint (no auth required)
  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // Auth middleware for API routes
  const requireAuth: MiddlewareHandler = (c: Context, next: Next) => {
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
    const redacted: Record<string, Omit<AgentConfig, 'token'> & { token: string }> = {};
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
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Math.max(1, Math.min(10000, parseInt(limitParam, 10) || 200)) : 200;
    const entries = readAuditLog(config, limit);
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 400);
    }
  });

  app.put('/api/agents/:id', async (c) => {
    const id = c.req.param('id');
    if (!config.agents[id]) return c.json({ error: 'Agent not found' }, 404);
    try {
      const body = await c.req.json() as AgentRequestBody;
      const err = validateAgentFields(body, false);
      if (err) return c.json({ error: err }, 400);
      if (body.scopes !== undefined) config.agents[id].scopes = body.scopes;
      if (body.allowlist !== undefined) config.agents[id].allowlist = body.allowlist;
      if (body.rateLimit !== undefined) config.agents[id].rateLimit = body.rateLimit;
      if (body.token !== undefined) config.agents[id].token = body.token;
      writeConfigAtomic(configPath, config);
      reloadCfg();
      return c.json({ ok: true });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 400);
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
