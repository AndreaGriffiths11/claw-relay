// Claw Relay — WebSocket Relay Server
// This runs as a standalone Node.js process that bridges agents to the extension.
// The extension connects to this server as a client, and agents also connect as clients.
// The server routes messages between them.

const WebSocket = require('ws');

const PORT = parseInt(process.env.CLAW_RELAY_PORT || '19222', 10);
const AUTH_TOKEN = process.env.CLAW_RELAY_TOKEN || null;

let extensionSocket = null;
let agentSocket = null;
let pendingResponses = new Map();
let requestId = 0;

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`🦀 Claw Relay server listening on ws://localhost:${PORT}`);
  if (AUTH_TOKEN) console.log(`   Auth token required: ${AUTH_TOKEN}`);
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get('role'); // 'extension' or 'agent'
  const token = url.searchParams.get('token');

  // Auth check for agents
  if (role === 'agent' && AUTH_TOKEN && token !== AUTH_TOKEN) {
    ws.close(4001, 'Invalid auth token');
    console.log('❌ Agent connection rejected: bad token');
    return;
  }

  if (role === 'extension') {
    extensionSocket = ws;
    console.log('🔌 Extension connected');
    if (agentSocket) {
      agentSocket.send(JSON.stringify({ type: 'extension_connected' }));
    }
  } else {
    agentSocket = ws;
    console.log('🤖 Agent connected');
    if (extensionSocket) {
      extensionSocket.send(JSON.stringify({ type: 'agent_connected' }));
    }
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (role === 'agent') {
        // Forward agent requests to extension
        if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
          const id = ++requestId;
          msg._requestId = id;
          extensionSocket.send(JSON.stringify(msg));
        } else {
          ws.send(JSON.stringify({ type: 'error', error: 'Extension not connected' }));
        }
      } else if (role === 'extension') {
        // Forward extension responses to agent
        if (agentSocket && agentSocket.readyState === WebSocket.OPEN) {
          agentSocket.send(JSON.stringify(msg));
        }
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    if (role === 'extension') {
      extensionSocket = null;
      console.log('🔌 Extension disconnected');
      if (agentSocket) agentSocket.send(JSON.stringify({ type: 'extension_disconnected' }));
    } else {
      agentSocket = null;
      console.log('🤖 Agent disconnected');
      if (extensionSocket) extensionSocket.send(JSON.stringify({ type: 'agent_disconnected' }));
    }
  });
});
