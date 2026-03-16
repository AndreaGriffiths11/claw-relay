# Claw Relay 🦞

A trust layer between AI agents and your real browser.

Agents connect via WebSocket → Claw Relay checks auth, permissions, and site access → then forwards actions to [agent-browser](https://github.com/vercel-labs/agent-browser), which controls Chrome via CDP.

**The result:** An AI agent can read pages, click buttons, fill forms, and navigate — on your actual browser, with your cookies and sessions — while you control exactly what it's allowed to touch.

## ⚠️ What You're Doing Here

This gives AI agents real control over a real browser. Your browser. With your sessions.

That means:

- **An agent with `interact` scope can click buttons and submit forms.** If you allow `github.com`, it can merge PRs, delete repos, change settings — anything a click can do.
- **An agent with `navigate` scope can go to any allowed URL.** It sees what you'd see when logged in.
- **An agent with `execute` scope can run JavaScript on the page.** This is the nuclear option. It can read page content, exfiltrate data, or modify the DOM.

**This is experimental software.** It works, but it's new. Use it knowing that.

### How to Not Shoot Yourself in the Foot

1. **Start with `read` scope only.** Let agents see pages before you let them touch anything.
2. **Use tight allowlists.** `["github.com"]` is better than `["*"]`. Much better.
3. **Never put banking, email, or auth provider sites in an allowlist.** The global blocklist exists for this — use it.
4. **Check the audit log.** Every action is logged to `audit.jsonl` with timestamps, agent ID, what it did, and whether it worked.
5. **Don't hand out `execute` scope** unless you understand what JavaScript injection means on a page where you're logged in.
6. **Run Chrome with `--user-data-dir=/tmp/chrome-debug`** to test with a clean profile before connecting your real one.

The blocklist always wins over allowlists. If `*.bank.com` is blocked, no agent can touch it regardless of their allowlist.

## How It Works

![Architecture](docs/architecture.png)

## Quick Start (One Command)

```bash
./start.sh                     # starts Chrome + relay + Cloudflare tunnel
./start.sh --tunnel tailscale  # use Tailscale instead
./start.sh --no-tunnel         # local only
./stop.sh                      # stop everything
```

The launch script handles Chrome, agent-browser, the relay server, and the tunnel in one shot. Ctrl+C to stop.

If you prefer to run each piece manually, keep reading.

## Manual Setup

### Prerequisites

```bash
npm install -g agent-browser    # browser automation engine
brew install cloudflared        # only if you want remote access (optional)
```

### 1. Build the relay

```bash
cd relay-server
npm install          # ← must be inside relay-server/, not the repo root
npx tsc              # ← compiles TypeScript — required before first run
```

### 2. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:

```yaml
server:
  port: 9333              # ⚠️ Do NOT use 9222 — that's Chrome's debugging port
  host: "0.0.0.0"         # accepts connections from tunnels and local

agents:
  my-agent:
    token: "pick-a-strong-secret"   # change this
    scopes: ["read"]                # start with read, add more later
    allowlist: ["github.com"]       # be specific — avoid ["*"]
    rateLimit: 30

blocklist:                # global — always wins over allowlists
  - "*.bank.com"
  - "mail.google.com"
  - "accounts.google.com"

audit:
  logFile: "./audit.jsonl"
  logToStdout: true

engine:
  binary: "agent-browser"
  timeout: 30000
```

> **⚠️ YAML gotcha:** Each key can only appear once per block. If you're editing and want to change `host`, replace the line — don't add a second `host:` line or YAML will crash with `DUPLICATE_KEY`.

### 3. Launch Chrome with remote debugging

**You must quit Chrome completely first** (Cmd+Q on macOS, not just close windows). The debug port won't bind if Chrome is already running.

```bash
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug

# Linux:
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

> **Why `--user-data-dir`?** Chrome refuses to enable remote debugging without it. Use `/tmp/chrome-debug` for a clean test profile, or point it to your real profile once you trust the setup.

### 4. Connect agent-browser to Chrome

```bash
agent-browser connect http://localhost:9222
```

> **Note:** The syntax is just `agent-browser connect <url>` — no `--cdp-url` flag.

### 5. Start the relay

```bash
node dist/index.js config.yaml
```

> **Note:** The config file is a required CLI argument — it's not auto-loaded.

You should see: `Claw Relay server listening on 0.0.0.0:9333`

### 6. Test it

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

## WebSocket Protocol

Connect to `ws://localhost:9333` (configurable).

**Auth** — first message must be:
```json
{"type": "auth", "token": "your-token", "agent_id": "your-agent"}
```

**Actions:**
| Action | Scope Required | Example |
|--------|---------------|---------|
| `snapshot` | `read` | `{"type": "snapshot"}` |
| `screenshot` | `read` | `{"type": "screenshot"}` |
| `click` | `interact` | `{"type": "click", "ref": "e5"}` |
| `type` | `interact` | `{"type": "type", "ref": "e3", "text": "hello"}` |
| `fill` | `interact` | `{"type": "fill", "ref": "e3", "text": "hello"}` |
| `press` | `interact` | `{"type": "press", "key": "Enter"}` |
| `hover` | `interact` | `{"type": "hover", "ref": "e2"}` |
| `select` | `interact` | `{"type": "select", "ref": "e7", "values": ["opt1"]}` |
| `navigate` | `navigate` | `{"type": "navigate", "url": "https://..."}` |
| `evaluate` | `execute` | `{"type": "evaluate", "js": "document.title"}` |
| `close` | any | `{"type": "close"}` |

**Responses:**
```json
{"type": "result", "action": "snapshot", "ok": true, "data": "...accessibility tree..."}
{"type": "error", "code": "permission_denied", "message": "Agent lacks 'interact' scope"}
{"type": "error", "code": "site_blocked", "message": "mail.google.com is blocked"}
```

## Remote Access (Tunneling)

To let a remote agent connect to your browser, you need a tunnel. The relay stays on your machine — the tunnel just makes it reachable.

### Option A: Cloudflare Quick Tunnel (easiest, no account needed)

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:9333
```

You'll get a URL like `https://random-words.trycloudflare.com`. The remote agent connects to `wss://random-words.trycloudflare.com/`.

> **Note:** Quick tunnels are temporary — the URL changes every time you restart cloudflared. For persistent tunnels, set up a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps).

### Option B: Tailscale (if both machines are on the same tailnet)

The remote agent connects to `ws://<your-tailscale-ip>:9333`.

### Option C: ngrok

```bash
ngrok http 9333
```

Use the provided `https://xxxx.ngrok-free.app` URL.

### Security Note

The tunnel exposes your relay to the internet, but every connection still requires a valid agent token. Without one, the relay rejects the connection. The allowlist, blocklist, scopes, and rate limiting all still apply — the tunnel is just transport.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `DUPLICATE_KEY` YAML error | You have two `host:` lines (or similar). Replace the line, don't add a second one. |
| Chrome won't start with debugging | Quit Chrome completely first (Cmd+Q). The debug port can't bind while Chrome is running. |
| `DevTools remote debugging requires a non-default data directory` | Add `--user-data-dir=/tmp/chrome-debug` to your Chrome launch command. |
| `502` from tunnel | The relay server isn't running. Start it with `node dist/index.js config.yaml`. |
| `Connection refused` on port 9333 | Either the relay isn't running, or `host` is set to `"127.0.0.1"` and you're connecting from outside. Change to `"0.0.0.0"`. |
| Tunnel URL stopped working | Quick tunnels are ephemeral. Restart `cloudflared tunnel` to get a new URL. |
| `agent-browser connect` errors | Make sure Chrome is running with `--remote-debugging-port=9222` and the port is reachable. |
| TypeScript errors / `dist/index.js` not found | Run `npx tsc` inside `relay-server/` to compile. |

## Chrome Extension

Optional status dashboard:

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `extension/`
4. Click the icon to see connection status and recent actions

## Audit Log

Every action is logged to `audit.jsonl`:

```json
{"timestamp":"2026-03-16T14:17:20.639Z","agent_id":"deploy-bot","action":"navigate","target":"https://mail.google.com","ok":false,"duration_ms":0,"error":"site_blocked"}
{"timestamp":"2026-03-16T14:17:20.985Z","agent_id":"deploy-bot","action":"click","target":"e1","ok":true,"duration_ms":175}
```

## License

MIT
