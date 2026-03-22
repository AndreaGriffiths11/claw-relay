import * as path from 'path';
import { loadConfig, reloadConfig, authenticate, AgentConfig } from './auth';
import { parseMessage, isAuthMessage, isActionMessage, ActionMessage, OutgoingMessage } from './protocol';
import { hasPermission } from './permissions';
import { isAllowed } from './allowlist';
import { RateLimiter } from './rate-limiter';
import { AuditLogger } from './audit-logger';
import { Engine } from './engine';
import { agentConnected, agentDisconnected, agentAction, getState } from './state';
import { startDashboard } from './dashboard';

import type { ServerWebSocket } from 'bun';

const configPath = process.argv[2] || path.join(import.meta.dir, '..', 'config.example.yaml');
let config = loadConfig(configPath);

export function reloadCurrentConfig(): void {
  config = reloadConfig(configPath);
}

export function getConfigPath(): string {
  return configPath;
}
const rateLimiter = new RateLimiter();
const audit = new AuditLogger(config.audit.logFile, config.audit.logToStdout);
const engine = new Engine(config.engine.binary, config.engine.timeout);

interface ClientState {
  authenticated: boolean;
  agentId?: string;
  agentConfig?: AgentConfig;
}

const clients = new WeakMap<object, ClientState>();
const connectedAgentIds = new Map<string, ServerWebSocket<unknown>>();
const lastPong = new Map<string, number>();

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_CONNECTION_MS = 90_000;

// Heartbeat: ping every 30s, kill stale connections after 90s
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [agentId, ws] of connectedAgentIds) {
    const last = lastPong.get(agentId) || now;
    const timeSinceLastPong = now - last;
    const isStale = timeSinceLastPong > STALE_CONNECTION_MS;
    if (isStale) {
      console.warn(`Agent ${agentId} stale (no pong in 90s), disconnecting`);
      ws.close(1001, 'Connection stale');
      continue;
    }
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, HEARTBEAT_INTERVAL_MS);

function send(ws: ServerWebSocket<unknown>, msg: OutgoingMessage) {
  const serialized = JSON.stringify(msg);
  ws.send(serialized);
}

async function handleMessage(ws: ServerWebSocket<unknown>, raw: string) {
  const state = clients.get(ws)!;
  const msg = parseMessage(raw);
  if (!msg) {
    send(ws, { type: 'error', code: 'invalid_message', message: 'Could not parse message' });
    return;
  }

  // Handle pong
  if (msg.type === 'pong') {
    const s = clients.get(ws);
    if (s?.agentId) lastPong.set(s.agentId, Date.now());
    return;
  }

  // Auth flow
  if (!state.authenticated) {
    if (!isAuthMessage(msg)) {
      send(ws, { type: 'error', code: 'not_authenticated', message: 'Send auth message first' });
      return;
    }
    const agentConfig = authenticate(config, msg.token, msg.agent_id);
    if (!agentConfig) {
      send(ws, { type: 'error', code: 'auth_failed', message: 'Invalid token or agent_id' });
      ws.close();
      return;
    }
    // Reject duplicate agent ID
    if (connectedAgentIds.has(msg.agent_id)) {
      console.warn(`Warning: Duplicate agent ID rejected: ${msg.agent_id}`);
      send(ws, { type: 'error', code: 'duplicate_agent', message: 'Agent ID already connected' });
      ws.close(4009, 'Agent ID already connected');
      return;
    }
    state.authenticated = true;
    state.agentId = msg.agent_id;
    state.agentConfig = agentConfig;
    connectedAgentIds.set(msg.agent_id, ws);
    lastPong.set(msg.agent_id, Date.now());
    agentConnected(msg.agent_id);
    send(ws, { type: 'result', action: 'auth', ok: true });
    return;
  }

  // Action flow
  if (!isActionMessage(msg)) {
    send(ws, { type: 'error', code: 'invalid_action', message: 'Unknown action type' });
    return;
  }

  const actionMsg = msg as ActionMessage;
  const agentId = state.agentId!;
  const agentCfg = state.agentConfig!;
  const reqId = actionMsg.request_id;

  // Permission check
  if (!hasPermission(agentCfg.scopes, actionMsg.type)) {
    send(ws, { type: 'error', code: 'permission_denied', message: `Agent lacks required scope for '${actionMsg.type}'`, request_id: reqId });
    audit.log({ agent_id: agentId, action: actionMsg.type, ok: false, duration_ms: 0, error: 'permission_denied' });
    return;
  }

  // Rate limit check
  if (!rateLimiter.check(agentId, agentCfg.rateLimit)) {
    send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded', request_id: reqId });
    audit.log({ agent_id: agentId, action: actionMsg.type, ok: false, duration_ms: 0, error: 'rate_limited' });
    return;
  }

  // URL allowlist check
  if (actionMsg.type === 'navigate' && actionMsg.url) {
    const check = isAllowed(actionMsg.url, agentCfg.allowlist, config.blocklist);
    if (!check.allowed) {
      const reason = check.reason || 'Site blocked';
      send(ws, { type: 'error', code: 'site_blocked', message: reason, request_id: reqId });
      audit.log({ agent_id: agentId, action: actionMsg.type, target: actionMsg.url, ok: false, duration_ms: 0, error: 'site_blocked' });
      return;
    }
  } else if (actionMsg.type !== 'close') {
    const currentUrl = await engine.getCurrentUrl();
    if (currentUrl) {
      const check = isAllowed(currentUrl, agentCfg.allowlist, config.blocklist);
      if (!check.allowed) {
        const reason = check.reason || 'Current site blocked';
        send(ws, { type: 'error', code: 'site_blocked', message: reason, request_id: reqId });
        audit.log({ agent_id: agentId, action: actionMsg.type, target: currentUrl, ok: false, duration_ms: 0, error: 'site_blocked' });
        return;
      }
    }
  }

  // Execute
  const startTime = Date.now();
  const result = await engine.execute(actionMsg);
  const endTime = Date.now();
  const duration = endTime - startTime;

  const target = actionMsg.ref || actionMsg.url || actionMsg.key || undefined;
  agentAction(agentId, actionMsg.type);
  audit.log({ agent_id: agentId, action: actionMsg.type, target, ok: result.ok, duration_ms: duration, error: result.error });

  if (result.ok) {
    // For screenshots, tunnel the image data as base64
    if (actionMsg.type === 'screenshot' && result.data) {
      // Extract file path from agent-browser output (e.g. "✓ Screenshot saved to /path/to/file.png")
      const pathMatch = result.data.match(/\/\S+\.png/);
      const screenshotPath = pathMatch ? pathMatch[0] : result.data.trim();
      try {
        const file = Bun.file(screenshotPath);
        const buf = await file.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        send(ws, {
          type: 'result',
          action: 'screenshot',
          ok: true,
          data: base64,
          mimeType: 'image/png',
          request_id: reqId,
        });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // Fall back to just the path if file read fails
        console.error(`Screenshot tunnel error: ${errMsg} (path: ${screenshotPath})`);
        send(ws, { type: 'result', action: 'screenshot', ok: true, data: result.data, request_id: reqId });
      }
    } else {
      send(ws, { type: 'result', action: actionMsg.type, ok: true, data: result.data, request_id: reqId });
    }
  } else {
    const errorMessage = result.error || 'Unknown error';
    send(ws, { type: 'error', code: 'engine_error', message: errorMessage, request_id: reqId });
  }
}

// WebSocket server using Bun.serve()
const wsServer = Bun.serve({
  port: config.server.port,
  hostname: config.server.host,
  fetch(req, server) {
    // Upgrade WebSocket connections
    if (server.upgrade(req)) {
      return; // upgraded
    }
    return new Response('WebSocket server', { status: 200 });
  },
  websocket: {
    open(ws) {
      clients.set(ws, { authenticated: false });
    },
    message(ws, message) {
      const isString = typeof message === 'string';
      const decoded = isString ? message : new TextDecoder().decode(message);
      handleMessage(ws, decoded);
    },
    close(ws) {
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

console.log(`Claw Relay server listening on ${config.server.host}:${config.server.port}`);

// Graceful shutdown
function gracefulShutdown() {
  console.log('Shutting down gracefully...');
  clearInterval(heartbeatInterval);
  wsServer.stop();
  console.log('Server stopped');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startDashboard(config, getState, configPath, () => { reloadCurrentConfig(); });
