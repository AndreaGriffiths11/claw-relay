<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

<p align="center"><strong>A trust layer between AI agents and your real browser.</strong></p>

Agents connect via WebSocket → Claw Relay checks auth, permissions, and site access → then forwards actions to [agent-browser](https://github.com/vercel-labs/agent-browser), which controls Chrome via CDP.

An AI agent can read pages, click buttons, fill forms, navigate, and **see the browser via screenshot tunneling** — on your actual browser, with your cookies and sessions — while you control exactly what it's allowed to touch.

<p align="center">
  <img src="docs/architecture.png" alt="Claw Relay Architecture" width="600">
</p>

## How It Works

Claw Relay has two pieces:

1. **Relay server** — routes WebSocket traffic between agents and Chrome, enforces auth/permissions/allowlists
2. **[agent-browser](https://github.com/vercel-labs/agent-browser)** — Rust CLI that controls Chrome via CDP

The relay server has two implementations (same config, same protocol, pick one):
- [Bun/TypeScript](relay-server/) — original, includes dashboard UI
- [Rust](relay-core/) — drop-in replacement, single binary

## Quick Start

```bash
git clone https://github.com/AndreaGriffiths11/claw-relay.git
cd claw-relay
cp relay-server/config.example.yaml relay-server/config.yaml
./start.sh
```

That's it. The startup script checks for dependencies (Bun, agent-browser) and installs them automatically if missing. It then launches Chrome, connects agent-browser, starts the relay server, and opens a Cloudflare tunnel.

Screenshots are tunneled as base64 data directly over the WebSocket — agents receive `{ data: "<base64>", mimeType: "image/png" }` in the response, so they can see the browser without needing filesystem access.

Open `http://localhost:9334` for the dashboard — add agents, set scopes, manage allowlists.

For manual setup or advanced options: **[Setup Guide →](docs/setup.md)**

## Security Model

- **Scopes** control what agents can do (`read`, `navigate`, `interact`, `execute`)
- **Allowlists** control where agents can go (`github.com`, not `*`)
- **Blocklist** always wins — blocked sites can't be reached by any agent
- **Rate limiting** per agent
- **Screenshot tunneling** — agents receive full-page screenshots as base64 PNG data over WebSocket, no file paths or local storage needed
- **Audit log** records every action with timestamps

Start with `read` scope only. Add more when you trust the setup.

## Documentation

| Doc | What's in it |
|-----|-------------|
| [Setup Guide](docs/setup.md) | Install, configure, launch — step by step |
| [Dashboard](docs/dashboard.md) | Web UI for managing agents and viewing audit logs |
| [Protocol](docs/protocol.md) | WebSocket API reference — auth, actions, responses, scopes |
| [Tunnels](docs/tunnels.md) | Remote access via Cloudflare, Tailscale, or ngrok |
| [Agent Skill](SKILL.md) | Drop-in skill file for AI agents (OpenClaw, Copilot CLI, Claude) |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Chrome Extension

Optional status dashboard for your browser toolbar:

1. Open `chrome://extensions` → Enable "Developer mode"
2. Click "Load unpacked" → select `extension/`
3. Click the icon to see connection status and recent actions

## MCP Server (Copilot CLI / Any MCP Client)

The `mcp/` directory contains a stdio-based MCP server that bridges any MCP-compatible client (GitHub Copilot CLI, Claude Desktop, etc.) to Claw Relay.

### Setup

```bash
cd mcp && npm install
```

### Tools Exposed

| Tool | Params | Description |
|------|--------|-------------|
| `browser_navigate` | `url` | Navigate to a URL |
| `browser_click` | `ref` | Click element by ref |
| `browser_type` | `ref`, `text` | Type text into element (appends) |
| `browser_fill` | `ref`, `text` | Fill input (replaces content) |
| `browser_press` | `key` | Press a key (Enter, Tab, etc.) |
| `browser_snapshot` | — | Get accessibility tree |
| `browser_screenshot` | — | Take a screenshot |

### Usage with Copilot CLI

```bash
copilot-cli --additional-mcp-config '{"claw-relay":{"command":"node","args":["path/to/claw-relay/mcp/claw-relay-mcp.js"],"env":{"CLAW_RELAY_URL":"wss://your-tunnel.trycloudflare.com/","CLAW_RELAY_AGENT":"copilot","CLAW_RELAY_TOKEN":"your-token"}}}'
```

Or in a config file (`~/.config/github-copilot/mcp.json`):

```json
{
  "mcpServers": {
    "claw-relay": {
      "command": "node",
      "args": ["path/to/claw-relay/mcp/claw-relay-mcp.js"],
      "env": {
        "CLAW_RELAY_URL": "wss://your-tunnel.trycloudflare.com/",
        "CLAW_RELAY_TOKEN": "your-token",
        "CLAW_RELAY_AGENT": "copilot"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAW_RELAY_URL` | Yes | WebSocket URL of the Claw Relay server |
| `CLAW_RELAY_TOKEN` | Yes | Auth token matching relay config |
| `CLAW_RELAY_AGENT` | No | Agent ID (default: `copilot`) |

## Powered By

[OpenClaw](https://openclaw.ai) · [agent-browser](https://github.com/vercel-labs/agent-browser) · [Rust](https://www.rust-lang.org) · [Bun](https://bun.sh) · [Hono](https://hono.dev) · [TanStack](https://tanstack.com) · [Railway](https://railway.com) · [Cloudflare](https://cloudflare.com)

## License

MIT
