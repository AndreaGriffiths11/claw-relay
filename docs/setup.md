# Setup Guide

## Prerequisites

```bash
curl -fsSL https://bun.sh/install | bash   # install Bun runtime (or use Rust — see step 5)
cargo install agent-browser                # browser automation engine (Rust CLI)
brew install cloudflared                   # only if you want remote access (optional)
```

> **Note:** `start.sh` checks for these dependencies and installs them automatically if missing.

## 1. Install Dependencies

```bash
cd relay-server
bun install          # must be inside relay-server/, not the repo root
```

> No build step needed — Bun runs TypeScript directly.

## 2. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:

```yaml
server:
  port: 9333              # don't use 9222 — that's Chrome's debugging port
  host: "0.0.0.0"         # accepts connections from tunnels and local

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

audit:
  logFile: "./audit.jsonl"
  logToStdout: true

engine:
  binary: "agent-browser"
  timeout: 30000

dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

> **YAML gotcha:** Each key can only appear once per block. Replace lines — don't add duplicates.

## 3. Launch Chrome with Remote Debugging

Quit Chrome completely first (Cmd+Q on macOS). The debug port won't bind if Chrome is already running.

```bash
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug

# Linux:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

> Use `/tmp/chrome-debug` for a clean test profile, or point to your real profile once you trust the setup.

## 4. Connect agent-browser to Chrome

```bash
agent-browser connect http://localhost:9222
```

## 5. Start the Relay

**Bun (default):**
```bash
cd relay-server
bun src/index.ts config.yaml
```

**Rust (single binary, no runtime deps):**
```bash
cd relay-core
cargo build --release
./target/release/claw-relay-core ../relay-server/config.yaml
```

You should see:
```
Claw Relay server listening on 0.0.0.0:9333
Dashboard running on http://localhost:9334
```

## One-Command Start

Or skip all of the above:

```bash
./start.sh                     # starts Chrome + relay + tunnel
./start.sh --tunnel tailscale  # use Tailscale instead
./start.sh --no-tunnel         # local only
./stop.sh                      # stop everything
```

## 6. Test It

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

You should see an accessibility tree of whatever tab is open in Chrome.

## Rate Limiting

`rateLimit` sets the maximum number of actions an agent can perform per minute. If an agent exceeds this, the relay rejects further actions until the window resets.

This is a safety net — if an agent enters a loop, gets prompt-injected, or just goes rogue, rate limiting prevents it from hammering your browser with thousands of actions.

**Recommendations:**

| Use case | Suggested `rateLimit` | Why |
|---|---|---|
| Read-only agent (scraping, monitoring) | `15–30` | Just reading pages, low action count |
| Interactive agent (clicking, filling forms) | `30–60` | Needs more headroom for multi-step flows |
| Power agent (automation, testing) | `60–120` | Rapid sequences, but still bounded |
| Development / debugging | `300` | High limit while you're watching |

**If you're not sure, start with `30`.** That's one action every 2 seconds — enough for most agents, low enough to catch runaway loops. You can always increase it after observing your agent's behavior.

Setting `rateLimit` is optional. If omitted, the agent has no action cap — fine for trusted local setups, but recommended for any agent with remote access.
