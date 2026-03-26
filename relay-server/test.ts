import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:9333');

ws.on('open', () => {
  console.log('Connected. Sending auth...');
  ws.send(JSON.stringify({ type: 'auth', token: process.env.RELAY_TOKEN || 'secret-token-1', agent_id: process.env.RELAY_AGENT || 'deploy-bot' }));
});

ws.on('message', (data: Buffer) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', JSON.stringify(msg, null, 2));

  if (msg.type === 'result' && msg.action === 'auth' && msg.ok) {
    console.log('Authenticated. Sending snapshot...');
    ws.send(JSON.stringify({ type: 'snapshot' }));
  } else if (msg.type === 'result' && msg.action === 'snapshot') {
    console.log('Snapshot received. Done.');
    ws.close();
  } else if (msg.type === 'error') {
    console.error('Error:', msg.message);
    ws.close();
  }
});

ws.on('error', (err: Error) => {
  console.error('Connection error:', err.message);
});

ws.on('close', () => {
  console.log('Disconnected.');
  process.exit(0);
});
