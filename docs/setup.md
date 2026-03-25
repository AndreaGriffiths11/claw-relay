# Setup Guide

## Quick Start

```bash
bunx claw-relay
```

On first run, this will:
1. Generate `config.yaml` with random tokens
2. Launch a dedicated Chrome window with remote debugging
3. Start the relay server + dashboard
4. Print connection info

The Chrome window uses a dedicated profile at `~/.claw-relay/chrome-data/`. Your normal Chrome stays untouched.

**First time only:** Sign into any sites you want your agent to access (GitHub, etc.) in the Claw Relay Chrome window. Logins persist between restarts.

## Restarting

```bash
# Ctrl+C stops the relay server
# Chrome stays open — tabs, logins preserved

bunx claw-relay
# Detects running Chrome, reconnects without relaunching
```

## Remote Access (Tunnels)

For agents running on a different machine, use `start.sh` with a tunnel (available when you've cloned the repo — the primary install method is `bunx claw-relay`):

```bash
./start.sh                        # Cloudflare quick tunnel (default)
./start.sh --tunnel none          # local only
./start.sh --tunnel tailscale     # Tailscale
```

See [Tunnels](tunnels.md) for more options.

## Configuration

Auto-generated on first run. Edit `config.yaml` to customize:

```yaml
server:
  port: 9333
  host: "0.0.0.0"

agents:
  my-agent:
    token: "crly_..."              # auto-generated
    scopes: ["read", "navigate", "interact"]
    allowlist: ["github.com"]      # where the agent can go
    rateLimit: 30                  # actions per minute

blocklist:
  - "*.bank.com"                   # always blocked for all agents

engine:
  timeout: 30000

dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

## CLI Options

```
bunx claw-relay [options]

  --port <number>    Server port (default: 9333)
  --config <path>    Custom config path
  --no-chrome        Skip Chrome launch (use if Chrome is already running with CDP)
```

## Chrome Extension (Optional)

For accessing your normal Chrome instead of the dedicated window:

1. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
2. Click the toolbar icon on any tab to share it with the relay

No CDP flag needed — the extension bridges directly.

## Test Connection

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9333');
ws.on('open', () => ws.send(JSON.stringify({type:'auth',token:'YOUR_TOKEN',agent_id:'default'})));
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  console.log(JSON.stringify(m, null, 2));
  if (m.action === 'auth') ws.send(JSON.stringify({type:'snapshot'}));
  else ws.close();
});
"
```

## Rate Limiting

`rateLimit` sets max actions per minute per agent.

| Use case | Suggested limit |
|---|---|
| Read-only | `15–30` |
| Interactive | `30–60` |
| Power agent | `60–120` |
| Development | `300` |

Start with `30` if unsure.
