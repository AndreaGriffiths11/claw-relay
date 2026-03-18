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
const connectedAgentIds = new Map<string, any>();

function send(ws: any, msg: OutgoingMessage) {
  ws.send(JSON.stringify(msg));
}

async function handleMessage(ws: any, raw: string) {
  const state = clients.get(ws)!;
  const msg = parseMessage(raw);
  if (!msg) {
    send(ws, { type: 'error', code: 'invalid_message', message: 'Could not parse message' });
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

  // Permission check
  if (!hasPermission(agentCfg.scopes, actionMsg.type)) {
    send(ws, { type: 'error', code: 'permission_denied', message: `Agent lacks required scope for '${actionMsg.type}'` });
    audit.log({ agent_id: agentId, action: actionMsg.type, ok: false, duration_ms: 0, error: 'permission_denied' });
    return;
  }

  // Rate limit check
  if (!rateLimiter.check(agentId, agentCfg.rateLimit)) {
    send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
    audit.log({ agent_id: agentId, action: actionMsg.type, ok: false, duration_ms: 0, error: 'rate_limited' });
    return;
  }

  // URL allowlist check
  if (actionMsg.type === 'navigate' && actionMsg.url) {
    const check = isAllowed(actionMsg.url, agentCfg.allowlist, config.blocklist);
    if (!check.allowed) {
      send(ws, { type: 'error', code: 'site_blocked', message: check.reason || 'Site blocked' });
      audit.log({ agent_id: agentId, action: actionMsg.type, target: actionMsg.url, ok: false, duration_ms: 0, error: 'site_blocked' });
      return;
    }
  } else if (actionMsg.type !== 'close') {
    const currentUrl = await engine.getCurrentUrl();
    if (currentUrl) {
      const check = isAllowed(currentUrl, agentCfg.allowlist, config.blocklist);
      if (!check.allowed) {
        send(ws, { type: 'error', code: 'site_blocked', message: check.reason || 'Current site blocked' });
        audit.log({ agent_id: agentId, action: actionMsg.type, target: currentUrl, ok: false, duration_ms: 0, error: 'site_blocked' });
        return;
      }
    }
  }

  // Execute
  const start = Date.now();
  const result = await engine.execute(actionMsg);
  const duration = Date.now() - start;

  const target = actionMsg.ref || actionMsg.url || actionMsg.key || undefined;
  agentAction(agentId, actionMsg.type);
  audit.log({ agent_id: agentId, action: actionMsg.type, target, ok: result.ok, duration_ms: duration, error: result.error });

  if (result.ok) {
    send(ws, { type: 'result', action: actionMsg.type, ok: true, data: result.data });
  } else {
    send(ws, { type: 'error', code: 'engine_error', message: result.error || 'Unknown error' });
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
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      handleMessage(ws, raw);
    },
    close(ws) {
      const state = clients.get(ws);
      if (state?.agentId) {
        connectedAgentIds.delete(state.agentId);
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
  wsServer.stop();
  console.log('Server stopped');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startDashboard(config, getState, configPath, () => { reloadCurrentConfig(); });
