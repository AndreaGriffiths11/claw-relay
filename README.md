<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

<p align="center"><strong>A trust layer between AI agents and your real browser.</strong></p>

Agents connect via WebSocket → Claw Relay checks auth, permissions, and site access → then forwards actions to [agent-browser](https://github.com/vercel-labs/agent-browser), which controls Chrome via CDP.

An AI agent can read pages, click buttons, fill forms, and navigate — on your actual browser, with your cookies and sessions — while you control exactly what it's allowed to touch.

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

Open `http://localhost:9334` for the dashboard — add agents, set scopes, manage allowlists.

For manual setup or advanced options: **[Setup Guide →](docs/setup.md)**

## Security Model

- **Scopes** control what agents can do (`read`, `navigate`, `interact`, `execute`)
- **Allowlists** control where agents can go (`github.com`, not `*`)
- **Blocklist** always wins — blocked sites can't be reached by any agent
- **Rate limiting** per agent
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

## Powered By

[OpenClaw](https://openclaw.ai) · [agent-browser](https://github.com/vercel-labs/agent-browser) · [Rust](https://www.rust-lang.org) · [Bun](https://bun.sh) · [Hono](https://hono.dev) · [TanStack](https://tanstack.com) · [Railway](https://railway.com) · [Cloudflare](https://cloudflare.com)

## License

MIT
