// Claw Relay™ — WebSocket server that sits between AI agents and
// a browser engine, enforcing permissions, rate limits, and site
// restrictions on every action.

import * as path from 'path';
import { loadConfig, authenticate, type Config, type AgentConfig } from './auth';
import { parseMessage, isAuthMessage, isActionMessage, type ActionMessage, type OutgoingMessage } from './protocol';
import { hasPermission } from './permissions';
import { isAllowed } from './allowlist';
import { RateLimiter } from './rate-limiter';
import { AuditLogger } from './audit-logger';
import { Engine } from './engine';
import { agentConnected, agentDisconnected, agentAction, getState } from './state';
import { startDashboard } from './dashboard';

import type { ServerWebSocket } from 'bun';

// --- Config ---

const configPath = process.argv[2] || path.join(import.meta.dir, '..', 'config.example.yaml');
let config = loadConfig(configPath);

export function reloadCurrentConfig(): void {
  config = loadConfig(configPath);
}

export function getConfigPath(): string {
  return configPath;
}

// --- Shared services ---

const rateLimiter = new RateLimiter();
const audit = new AuditLogger(config.audit.logFile, config.audit.logToStdout);
const engine = new Engine(config.engine.timeout);

// --- Connection tracking ---

interface ClientState {
  authenticated: boolean;
  agentId?: string;
  agentConfig?: AgentConfig;
  authAttempts: number;
}

const clients = new WeakMap<object, ClientState>();
const connectedAgentIds = new Map<string, ServerWebSocket<unknown>>();
const lastPong = new Map<string, number>();

// Max failed auth attempts per connection before forced disconnect
const MAX_AUTH_ATTEMPTS = 5;

// --- Heartbeat ---
// Ping connected agents every 30s. If an agent hasn't ponged in 90s,
// assume the connection is dead and drop it. Without this, zombie
// connections accumulate and block reconnection (duplicate agent ID check).

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;

// Max WebSocket message size — 1MB prevents memory exhaustion from
// oversized payloads while allowing large snapshots through
const MAX_MESSAGE_SIZE = 1024 * 1024;

// Unauthenticated connections must complete auth within this window.
// Prevents resource exhaustion from connections that open but never authenticate.
const AUTH_TIMEOUT_MS = 30_000;

// Max total concurrent WebSocket connections (authenticated + unauthenticated).
// Prevents resource exhaustion from connection floods.
const MAX_CONNECTIONS = 100;
let activeConnections = 0;

const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [agentId, ws] of connectedAgentIds) {
    const elapsed = now - (lastPong.get(agentId) || now);
    if (elapsed > STALE_THRESHOLD_MS) {
      console.warn(`Agent ${agentId} stale (no pong in 90s), disconnecting`);
      ws.close(1001, 'Connection stale');
      continue;
    }
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, HEARTBEAT_INTERVAL_MS);

// --- Dangerous URL schemes that should never be navigated to ---
const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:'];

// --- Message handling ---

function send(ws: ServerWebSocket<unknown>, msg: OutgoingMessage): void {
  ws.send(JSON.stringify(msg));
}

async function handleMessage(ws: ServerWebSocket<unknown>, raw: string): Promise<void> {
  const state = clients.get(ws)!;

  // #8: Message size limit
  if (raw.length > MAX_MESSAGE_SIZE) {
    send(ws, { type: 'error', code: 'message_too_large', message: 'Message exceeds 1MB limit' });
    return;
  }

  const msg = parseMessage(raw);

  if (!msg) {
    send(ws, { type: 'error', code: 'invalid_message', message: 'Could not parse message' });
    return;
  }

  if (msg.type === 'pong') {
    if (state.agentId) lastPong.set(state.agentId, Date.now());
    return;
  }

  // --- Authentication gate ---
  if (!state.authenticated) {
    if (!isAuthMessage(msg)) {
      send(ws, { type: 'error', code: 'not_authenticated', message: 'Send auth message first' });
      return;
    }
    handleAuth(ws, state, msg.token, msg.agent_id);
    return;
  }

  // --- Action pipeline ---
  if (!isActionMessage(msg)) {
    send(ws, { type: 'error', code: 'invalid_action', message: 'Unknown action type' });
    return;
  }

  await handleAction(ws, state, msg);
}

function handleAuth(ws: ServerWebSocket<unknown>, state: ClientState, token: string, agentId: string): void {
  // Rate limit auth attempts — 5 failures per connection
  if (state.authAttempts >= MAX_AUTH_ATTEMPTS) {
    audit.log({ agent_id: agentId || 'unknown', action: 'auth', ok: false, duration_ms: 0, error: 'auth_rate_limited' });
    send(ws, { type: 'error', code: 'rate_limited', message: 'Too many auth attempts' });
    ws.close(4029, 'Too many auth attempts');
    return;
  }

  const agentConfig = authenticate(config, token, agentId);
  if (!agentConfig) {
    state.authAttempts++;
    // #5: Log failed auth attempts for attack detection
    audit.log({ agent_id: agentId || 'unknown', action: 'auth', ok: false, duration_ms: 0, error: 'auth_failed' });
    send(ws, { type: 'error', code: 'auth_failed', message: 'Invalid token or agent_id' });
    ws.close();
    return;
  }

  // One connection per agent ID — prevents conflicting actions
  if (connectedAgentIds.has(agentId)) {
    console.warn(`Duplicate agent ID rejected: ${agentId}`);
    send(ws, { type: 'error', code: 'duplicate_agent', message: 'Agent ID already connected' });
    ws.close(4009, 'Agent ID already connected');
    return;
  }

  state.authenticated = true;
  state.agentId = agentId;
  state.agentConfig = agentConfig;
  engine.setRestrictions(agentId, agentConfig.allowlist, config.blocklist || []);
  connectedAgentIds.set(agentId, ws);
  lastPong.set(agentId, Date.now());
  agentConnected(agentId);
  audit.log({ agent_id: agentId, action: 'auth', ok: true, duration_ms: 0 });
  send(ws, { type: 'result', action: 'auth', ok: true });
}

async function handleAction(ws: ServerWebSocket<unknown>, state: ClientState, msg: ActionMessage): Promise<void> {
  const agentId = state.agentId!;
  const agentCfg = state.agentConfig!;
  const reqId = msg.request_id;

  // Permission check
  if (!hasPermission(agentCfg.scopes, msg.type)) {
    send(ws, { type: 'error', code: 'permission_denied', message: `Agent lacks scope for '${msg.type}'`, request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, ok: false, duration_ms: 0, error: 'permission_denied' });
    return;
  }

  // Rate limit check
  if (!rateLimiter.check(agentId, agentCfg.rateLimit)) {
    send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded', request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, ok: false, duration_ms: 0, error: 'rate_limited' });
    return;
  }

  // URL restriction — navigate checks the target URL,
  // all other actions check the current URL (except close)
  const blockError = await checkUrlRestrictions(msg, agentCfg);
  if (blockError) {
    send(ws, { type: 'error', code: 'site_blocked', message: blockError.reason, request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, target: blockError.url, ok: false, duration_ms: 0, error: 'site_blocked' });
    return;
  }

  // Execute and respond
  const startTime = Date.now();
  const result = await engine.execute(msg);
  const duration = Date.now() - startTime;
  const target = msg.ref || msg.url || msg.key || undefined;

  agentAction(agentId, msg.type);
  audit.log({ agent_id: agentId, action: msg.type, target, ok: result.ok, duration_ms: duration, error: result.error });

  if (!result.ok) {
    send(ws, { type: 'error', code: 'engine_error', message: result.error || 'Unknown error', request_id: reqId });
    return;
  }

  // Screenshots come as base64 directly from the engine
  if (msg.type === 'screenshot' && result.data) {
    send(ws, { type: 'result', action: 'screenshot', ok: true, data: result.data, mimeType: msg.imageType === 'jpeg' ? 'image/jpeg' : 'image/png', request_id: reqId, targetId: result.targetId });
  } else {
    send(ws, { type: 'result', action: msg.type, ok: true, data: result.data, request_id: reqId, targetId: result.targetId });
  }
}

async function checkUrlRestrictions(
  msg: ActionMessage,
  agentCfg: AgentConfig,
): Promise<{ reason: string; url: string } | null> {
  let urlToCheck: string | null = null;

  if (msg.type === 'navigate' && msg.url) {
    urlToCheck = msg.url;
  } else if (msg.type !== 'close') {
    urlToCheck = await engine.getCurrentUrl();
  }

  if (!urlToCheck) return null;

  // #17: Block dangerous URL schemes before allowlist/blocklist check
  const lowerUrl = urlToCheck.toLowerCase().trim();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return { reason: `Blocked URL scheme: ${scheme}`, url: urlToCheck };
    }
  }

  const check = isAllowed(urlToCheck, agentCfg.allowlist, config.blocklist);
  if (check.allowed) return null;
  return { reason: check.reason || 'Site blocked', url: urlToCheck };
}



// --- WebSocket server ---

const wsServer = Bun.serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch(req, server) {
    const origin = req.headers.get('Origin');
    if (origin) {
      const url = new URL(origin);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (!isLocal) {
        return new Response('Forbidden', { status: 403 });
      }
    }
    if (server.upgrade(req)) return;
    return new Response('Claw Relay™ WebSocket server', { status: 200 });
  },
  websocket: {
    // #8: Cap incoming WebSocket frame size
    maxPayloadLength: MAX_MESSAGE_SIZE,
    open(ws) {
      // Connection limit — reject if at capacity
      if (activeConnections >= MAX_CONNECTIONS) {
        ws.close(1013, 'Server at capacity');
        return;
      }
      activeConnections++;
      clients.set(ws, { authenticated: false, authAttempts: 0 });

      // Auth timeout — close if not authenticated within 30s
      setTimeout(() => {
        const state = clients.get(ws);
        if (state && !state.authenticated) {
          send(ws, { type: 'error', code: 'auth_timeout', message: 'Authentication timeout' });
          ws.close(4008, 'Auth timeout');
        }
      }, AUTH_TIMEOUT_MS);
    },
    message(ws, message) {
      const decoded = typeof message === 'string' ? message : new TextDecoder().decode(message);
      handleMessage(ws, decoded);
    },
    close(ws) {
      activeConnections--;
      const state = clients.get(ws);
      if (state?.agentId) {
        connectedAgentIds.delete(state.agentId);
        lastPong.delete(state.agentId);
        agentDisconnected(state.agentId);
        console.log(`Agent ${state.agentId} disconnected`);
      }
    },
  },
});

console.log(`Claw Relay™ listening on ${config.server.host}:${config.server.port}`);

// --- Graceful shutdown ---

function shutdown(): void {
  console.log('Shutting down...');
  clearInterval(heartbeatInterval);
  wsServer.stop();
  rateLimiter.destroy();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- Dashboard ---

startDashboard(config, getState, configPath, reloadCurrentConfig);
