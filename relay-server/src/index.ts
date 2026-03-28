// Claw Relay™ — WebSocket server that sits between AI agents and
// a browser engine, enforcing permissions, rate limits, and site
// restrictions on every action.

import * as path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, authenticate, type Config, type AgentConfig } from './auth';
import { parseMessage, isAuthMessage, isActionMessage, type ActionMessage, type OutgoingMessage } from './protocol';
import { hasPermission } from './permissions';
import { isAllowed } from './allowlist';
import { RateLimiter } from './rate-limiter';
import { AuditLogger } from './audit-logger';
import { Engine } from './engine';
import { agentConnected, agentDisconnected, agentAction, getState } from './state';
import { startDashboard } from './dashboard';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---

const configPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'config.yaml'));
let config = loadConfig(configPath);

export function reloadCurrentConfig(): void {
  config = loadConfig(configPath);

  // Hot-reload: re-apply scopes, allowlist, and rate limits for connected agents
  for (const [agentId, ws] of connectedAgentIds) {
    const agentCfg = config.agents[agentId];
    if (!agentCfg) {
      // Agent was removed from config — disconnect them
      console.log(`Agent ${agentId} removed from config, disconnecting`);
      ws.close(4010, 'Agent removed from config');
      continue;
    }

    // Update the cached agentConfig on the client state
    // WeakMap is keyed by ws object, so we need to walk connections
    const state = clients.get(ws);
    if (state) {
      state.agentConfig = agentCfg;
    }

    // Re-apply engine restrictions (allowlist + blocklist)
    engine.setRestrictions(agentId, agentCfg.allowlist, config.blocklist || []);
    console.log(`Agent ${agentId} config hot-reloaded`);
  }
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
export const connectedAgentIds = new Map<string, WebSocket>();
const lastPong = new Map<string, number>();

// Max failed auth attempts per connection before forced disconnect
const MAX_AUTH_ATTEMPTS = 5;

// --- Heartbeat ---
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 90_000;
const MAX_MESSAGE_SIZE = 1024 * 1024;
const AUTH_TIMEOUT_MS = 30_000;
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

// --- Dangerous URL schemes ---
const BLOCKED_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:'];

// --- Message handling ---

function send(ws: WebSocket, msg: OutgoingMessage): void {
  ws.send(JSON.stringify(msg));
}

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
  const state = clients.get(ws)!;

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

  if (!state.authenticated) {
    if (!isAuthMessage(msg)) {
      send(ws, { type: 'error', code: 'not_authenticated', message: 'Send auth message first' });
      return;
    }
    handleAuth(ws, state, msg.token, msg.agent_id);
    return;
  }

  if (!isActionMessage(msg)) {
    send(ws, { type: 'error', code: 'invalid_action', message: 'Unknown action type' });
    return;
  }

  await handleAction(ws, state, msg);
}

function handleAuth(ws: WebSocket, state: ClientState, token: string, agentId: string): void {
  if (state.authAttempts >= MAX_AUTH_ATTEMPTS) {
    audit.log({ agent_id: agentId || 'unknown', action: 'auth', ok: false, duration_ms: 0, error: 'auth_rate_limited' });
    send(ws, { type: 'error', code: 'rate_limited', message: 'Too many auth attempts' });
    ws.close(4029, 'Too many auth attempts');
    return;
  }

  const agentConfig = authenticate(config, token, agentId);
  if (!agentConfig) {
    state.authAttempts++;
    audit.log({ agent_id: agentId || 'unknown', action: 'auth', ok: false, duration_ms: 0, error: 'auth_failed' });
    send(ws, { type: 'error', code: 'auth_failed', message: 'Invalid token or agent_id' });
    ws.close();
    return;
  }

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

async function handleAction(ws: WebSocket, state: ClientState, msg: ActionMessage): Promise<void> {
  const agentId = state.agentId!;
  const agentCfg = state.agentConfig!;
  const reqId = msg.request_id;

  // Handle batch at protocol layer — enforce security per sub-action
  if (msg.type === 'batch') {
    if (!hasPermission(agentCfg.scopes, 'batch')) {
      send(ws, { type: 'error', code: 'permission_denied', message: `Agent lacks scope for 'batch'`, request_id: reqId });
      audit.log({ agent_id: agentId, action: 'batch', ok: false, duration_ms: 0, error: 'permission_denied' });
      return;
    }

    const results: Array<{ ok: boolean; action?: string; data?: string; error?: string }> = [];
    const startTime = Date.now();

    for (const action of (msg.actions || [])) {
      // Check permission for each sub-action
      if (!hasPermission(agentCfg.scopes, action.type, action)) {
        results.push({ ok: false, action: action.type, error: `Agent lacks scope for '${action.type}'` });
        audit.log({ agent_id: agentId, action: action.type, ok: false, duration_ms: 0, error: 'permission_denied' });
        if (msg.stopOnError) break;
        continue;
      }

      // Rate limit each sub-action
      if (!rateLimiter.check(agentId, agentCfg.rateLimit)) {
        results.push({ ok: false, action: action.type, error: 'Rate limit exceeded' });
        audit.log({ agent_id: agentId, action: action.type, ok: false, duration_ms: 0, error: 'rate_limited' });
        if (msg.stopOnError) break;
        continue;
      }

      // Blocklist check per sub-action
      const blockError = await checkUrlRestrictions(action, agentCfg);
      if (blockError) {
        results.push({ ok: false, action: action.type, error: blockError.reason });
        audit.log({ agent_id: agentId, action: action.type, target: blockError.url, ok: false, duration_ms: 0, error: 'site_blocked' });
        if (msg.stopOnError) break;
        continue;
      }

      // Execute the sub-action
      const result = await engine.execute(action);
      const target = action.ref || action.url || action.key || undefined;
      agentAction(agentId, action.type);
      audit.log({ agent_id: agentId, action: action.type, target, ok: result.ok, duration_ms: 0, error: result.error });

      if (result.ok) {
        results.push({ ok: true, action: action.type, data: result.data });
      } else {
        results.push({ ok: false, action: action.type, error: result.error });
        if (msg.stopOnError) break;
      }
    }

    const duration = Date.now() - startTime;
    audit.log({ agent_id: agentId, action: 'batch', ok: true, duration_ms: duration });
    send(ws, { type: 'result', action: 'batch', ok: true, data: JSON.stringify({ results }), request_id: reqId });
    return;
  }

  if (!hasPermission(agentCfg.scopes, msg.type, msg)) {
    send(ws, { type: 'error', code: 'permission_denied', message: `Agent lacks scope for '${msg.type}'`, request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, ok: false, duration_ms: 0, error: 'permission_denied' });
    return;
  }

  if (!rateLimiter.check(agentId, agentCfg.rateLimit)) {
    send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded', request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, ok: false, duration_ms: 0, error: 'rate_limited' });
    return;
  }

  const blockError = await checkUrlRestrictions(msg, agentCfg);
  if (blockError) {
    send(ws, { type: 'error', code: 'site_blocked', message: blockError.reason, request_id: reqId });
    audit.log({ agent_id: agentId, action: msg.type, target: blockError.url, ok: false, duration_ms: 0, error: 'site_blocked' });
    return;
  }

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

const server = createServer((req, res) => {
  if (!req.headers.upgrade) {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }
    res.writeHead(200);
    res.end('Claw Relay™ WebSocket server');
    return;
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_SIZE });

server.on('upgrade', (req, socket, head) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    socket.destroy();
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      if (!isLocal) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket) => {
  activeConnections++;
  const state: ClientState = { authenticated: false, authAttempts: 0 };
  clients.set(ws, state);

  setTimeout(() => {
    if (!state.authenticated) {
      send(ws, { type: 'error', code: 'auth_timeout', message: 'Authentication timeout' });
      ws.close(4008, 'Auth timeout');
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (data: Buffer | string) => {
    const decoded = typeof data === 'string' ? data : data.toString();
    handleMessage(ws, decoded);
  });

  ws.on('close', () => {
    activeConnections--;
    if (state.agentId) {
      connectedAgentIds.delete(state.agentId);
      lastPong.delete(state.agentId);
      agentDisconnected(state.agentId);
      console.log(`Agent ${state.agentId} disconnected`);
    }
  });
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`Claw Relay™ listening on ${config.server.host}:${config.server.port}`);
});

// --- Graceful shutdown ---

function shutdown(): void {
  console.log('Shutting down...');
  clearInterval(heartbeatInterval);
  wss.close();
  server.close();
  rateLimiter.destroy();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- Dashboard ---

startDashboard(config, getState, configPath, reloadCurrentConfig, connectedAgentIds, audit);
