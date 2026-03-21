<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

<p align="center"><strong>A trust layer between AI agents and your real browser.</strong></p>

Agents connect via WebSocket → Claw Relay checks auth, permissions, and site access → then forwards actions to [agent-browser](https://github.com/vercel-labs/agent-browser), which controls Chrome via CDP.

An AI agent can read pages, click buttons, fill forms, navigate, and **see the browser via screenshot tunneling** — on your actual browser, with your cookies and sessions — while you control exactly what it's allowed to touch.

<p align="center">
  <img src="docs/architecture.png" alt="Claw Relay Architecture" width="600">
</p>

## Quick Start

```bash
git clone https://github.com/AndreaGriffiths11/claw-relay.git
cd claw-relay
cp relay-server/config.example.yaml relay-server/config.yaml
./start.sh
```

The startup script installs dependencies, launches Chrome, starts the relay, and opens a tunnel. Dashboard at `http://localhost:9334`.

## How It Works

1. **Relay server** — WebSocket hub that routes agent traffic to Chrome, enforces auth/permissions/allowlists
2. **[agent-browser](https://github.com/vercel-labs/agent-browser)** — Rust CLI that controls Chrome via CDP

Two server implementations (same config, same protocol):
- [Bun/TypeScript](relay-server/) — original, includes dashboard
- [Rust](relay-core/) — drop-in replacement, single binary

## Security

- **Scopes** — what agents can do (`read`, `navigate`, `interact`, `execute`)
- **Allowlists** — where agents can go (`github.com`, not `*`)
- **Blocklist** — always wins, blocks override everything
- **Rate limiting** — per agent
- **Audit log** — every action timestamped

## Docs

| | |
|---|---|
| [Setup Guide](docs/setup.md) | Install, configure, launch |
| [MCP Server](docs/mcp.md) | Connect Copilot CLI, Claude Desktop, or any MCP client |
| [Tunnels](docs/tunnels.md) | Remote access via Cloudflare, Tailscale, or ngrok |
| [Protocol](docs/protocol.md) | WebSocket API reference |
| [Dashboard](docs/dashboard.md) | Web UI for agents and audit logs |
| [Agent Skill](SKILL.md) | Drop-in skill for AI agents |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Chrome Extension

Optional toolbar status dashboard:

1. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
2. Click the icon for connection status and recent actions

## Powered By

[OpenClaw](https://openclaw.ai) · [agent-browser](https://github.com/vercel-labs/agent-browser) · [Rust](https://www.rust-lang.org) · [Bun](https://bun.sh) · [Hono](https://hono.dev) · [TanStack](https://tanstack.com) · [Railway](https://railway.com) · [Cloudflare](https://cloudflare.com)

## License

MIT
