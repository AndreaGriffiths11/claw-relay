<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

<p align="center"><strong>A trust layer between AI agents and your real browser.</strong></p>

Agents connect via WebSocket → Claw Relay checks auth, permissions, and site access → then forwards actions to [agent-browser](https://github.com/vercel-labs/agent-browser), which controls Chrome via CDP.

An AI agent can read pages, click buttons, fill forms, and navigate — on your actual browser, with your cookies and sessions — while you control exactly what it's allowed to touch.

## Quick Start

```bash
./start.sh                     # starts Chrome + relay + dashboard + tunnel
```

Open `http://localhost:9334` for the dashboard. Add agents, set scopes, manage allowlists — all from the UI.

Or set up manually: **[Setup Guide →](docs/setup.md)**

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
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

## Chrome Extension

Optional status dashboard for your browser toolbar:

1. Open `chrome://extensions` → Enable "Developer mode"
2. Click "Load unpacked" → select `extension/`
3. Click the icon to see connection status and recent actions

## License

MIT
