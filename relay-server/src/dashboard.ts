// Dashboard HTTP server — admin API for managing agents, viewing audit
// logs, and checking relay status. Runs on a separate port from the
// WebSocket server. All /api/* routes require Bearer token auth.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import * as fs from 'fs';
import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import type { Context } from 'hono';
import type { Next } from 'hono/types';
import { type Config, type AgentConfig, loadConfig } from './auth';
import type { AgentState } from './state';
import { tailLines } from './audit-logger';

const __dirname = dirname(fileURLToPath(import.meta.url));

type GetStateFn = () => { connections: AgentState[]; startedAt: string };

// --- Auth helpers ---

function checkAuth(config: Config, req: Request): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const providedToken = authHeader.slice(7);
  const providedHash = crypto.createHash('sha256').update(providedToken).digest();
  const adminHash = crypto.createHash('sha256').update(config.dashboard.adminToken).digest();
  return crypto.timingSafeEqual(providedHash, adminHash);
}

function redactToken(token: string): string {
  if (token.length <= 4) return '****';
  return '****' + token.slice(-4);
}

// --- Config persistence ---

function writeConfigAtomic(configPath: string, config: Config): void {
  const data = {
    server: config.server,
    agents: config.agents,
    blocklist: config.blocklist,
    audit: config.audit,
    engine: config.engine,
    dashboard: config.dashboard,
  };
  const tmp = configPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, YAML.stringify(data), 'utf-8');
  fs.renameSync(tmp, configPath);
}

// --- Validation ---

const VALID_SCOPES = ['navigate', 'read', 'interact', 'execute'] as const;
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

interface AgentRequestBody {
  id?: string;
  token?: string;
  scopes?: string[];
  allowlist?: string[];
  rateLimit?: number;
}

function validateAgentFields(body: AgentRequestBody, requireIdToken: boolean): string | null {
  if (requireIdToken) {
    if (typeof body.id !== 'string' || !AGENT_ID_RE.test(body.id))
      return 'id must be alphanumeric/hyphens/underscores, 1-64 chars';
    if (typeof body.token !== 'string' || body.token.length < 8)
      return 'token must be a string of at least 8 characters';
  } else if (body.token !== undefined) {
    if (typeof body.token !== 'string' || body.token.length < 8)
      return 'token must be a string of at least 8 characters';
  }

  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes) || !body.scopes.every((s: string) => typeof s === 'string' && (VALID_SCOPES as readonly string[]).includes(s)))
      return 'scopes must be an array of: ' + VALID_SCOPES.join(', ');
  }

  if (body.allowlist !== undefined) {
    if (!Array.isArray(body.allowlist) || !body.allowlist.every((s: string) => typeof s === 'string'))
      return 'allowlist must be an array of strings';
  }

  if (body.rateLimit !== undefined) {
    if (typeof body.rateLimit !== 'number' || !Number.isInteger(body.rateLimit) || body.rateLimit <= 0)
      return 'rateLimit must be a positive integer';
  }

  return null;
}

// --- Audit log reading ---

function readAuditLog(config: Config, limit: number = 200): Record<string, unknown>[] {
  const logFile = config.audit.logFile;
  const absPath = path.isAbsolute(logFile) ? logFile : path.join(process.cwd(), logFile);
  const lines = tailLines(absPath, limit);
  return lines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Record<string, unknown>[];
}

// --- Dashboard server ---

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

  const dashPort = config.dashboard.port;
  app.use('*', cors({
    origin: [`http://localhost:${dashPort}`, `http://127.0.0.1:${dashPort}`],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
  });

  // Auth middleware
  const requireAuth = async (c: Context, next: Next) => {
    if (!config.dashboard.adminToken) {
      return c.json({ error: 'Dashboard disabled: no adminToken configured' }, 403);
    }
    if (!checkAuth(config, c.req.raw)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };

  app.use('/api/*', requireAuth);

  // --- Status & config endpoints ---

  app.get('/api/config', (c) => {
    const redacted: Record<string, Omit<AgentConfig, 'token'> & { token: string }> = {};
    for (const [id, agent] of Object.entries(config.agents)) {
      redacted[id] = { ...agent, token: redactToken(agent.token) };
    }
    return c.json({ agents: redacted, server: config.server, dashboard: { port: config.dashboard.port } });
  });

  app.get('/api/status', (c) => c.json(getState()));

  // --- Audit log endpoints ---

  app.get('/api/audit', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Math.max(1, Math.min(10000, parseInt(limitParam, 10) || 200)) : 200;
    return c.json({ entries: readAuditLog(config, limit) });
  });

  app.delete('/api/audit', (c) => {
    const logFile = config.audit.logFile;
    const absPath = path.isAbsolute(logFile) ? logFile : path.join(process.cwd(), logFile);
    try { fs.writeFileSync(absPath, '', 'utf-8'); } catch {}
    return c.json({ ok: true });
  });

  app.get('/api/audit/download', (c) => {
    const entries = readAuditLog(config);
    const dateStamp = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(entries, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="claw-relay-audit-${dateStamp}.json"`,
      },
    });
  });

  // --- Agent CRUD ---

  app.post('/api/agents', async (c) => {
    try {
      const body = await c.req.json() as AgentRequestBody;
      const err = validateAgentFields(body, true);
      if (err) return c.json({ error: err }, 400);

      const id = body.id!;
      if (config.agents[id]) return c.json({ error: 'Agent already exists' }, 409);

      config.agents[id] = {
        token: body.token!,
        scopes: body.scopes || ['read'],
        allowlist: body.allowlist || ['*'],
        rateLimit: body.rateLimit || 30,
      };
      writeConfigAtomic(configPath, config);
      reloadCfg();
      return c.json({ ok: true }, 201);
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
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
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
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

  // Serve built SPA from dashboard/dist, fall back to status page
  const distDir = path.join(__dirname, '..', 'dashboard', 'dist');
  const distExists = fs.existsSync(path.join(distDir, 'index.html'));

  if (distExists) {
    // Serve static assets
    app.use('/assets/*', serveStatic({ root: distDir.replace(/\/+$/, '') + '/' }));

    // SPA fallback
    app.get('*', (c) => {
      const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
      return c.html(html);
    });
  } else {
    app.get('*', (c) => {
      return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0f;color:#e2e8f0">
        <div style="text-align:center"><h1>🦞 Claw Relay™ Dashboard</h1><p style="color:#94a3b8">Run <code style="color:#06b6d4">cd dashboard && npm run build</code> to enable the full dashboard UI.</p></div>
      </body></html>`);
    });
  }

  serve({ fetch: app.fetch, port: config.dashboard.port });
  console.log(`Dashboard on http://localhost:${config.dashboard.port}`);
}
