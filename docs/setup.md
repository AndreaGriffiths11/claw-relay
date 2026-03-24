# Setup Guide

## Quick Start

```bash
bunx claw-relay
```

On first run, this will:
1. Generate `config.yaml` with random tokens
2. Launch Chrome with remote debugging (CDP)
3. Start the relay server + dashboard
4. Print connection info

## Manual Setup

### Prerequisites

```bash
curl -fsSL https://bun.sh/install | bash   # Bun runtime
brew install cloudflared                   # remote access (optional)
```

### 1. Install Dependencies

```bash
cd relay-server
bun install
```

### 2. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:

```yaml
server:
  port: 9333
  host: "0.0.0.0"

agents:
  my-agent:
    token: "pick-a-strong-secret"
    scopes: ["read"]
    allowlist: ["github.com"]
    rateLimit: 30

blocklist:
  - "*.bank.com"
  - "mail.google.com"
  - "accounts.google.com"

engine:
  timeout: 30000

dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

### 3. Launch Chrome with Remote Debugging

```bash
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Linux:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

### 4. Start the Relay

```bash
cd relay-server
bun src/index.ts config.yaml
```

### 5. Test It

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9333');
ws.on('open', () => ws.send(JSON.stringify({type:'auth',token:'pick-a-strong-secret',agent_id:'my-agent'})));
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  console.log(JSON.stringify(m, null, 2));
  if (m.action === 'auth') ws.send(JSON.stringify({type:'snapshot'}));
  else ws.close();
});
ws.on('close', () => process.exit(0));
"
```

## Chrome Extension

1. Open `chrome://extensions` → Developer mode
2. Load unpacked → select `extension/`
3. Click icon to configure relay URL and API key

## Rate Limiting

`rateLimit` sets max actions per minute per agent.

| Use case | Suggested limit |
|---|---|
| Read-only | `15–30` |
| Interactive | `30–60` |
| Power agent | `60–120` |
| Development | `300` |

Start with `30` if unsure.
