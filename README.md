<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

# Claw Relay

Give your AI agents a real browser.

## Quick Start

```bash
bunx claw-relay
```

Launches a dedicated Chrome window, starts the relay, generates config with random tokens. One command, zero setup.

**First time:** Sign into GitHub (or any site) in the Claw Relay Chrome window. Logins persist between restarts.

**Restart:** `Ctrl+C` stops the relay. Chrome stays open. Run `bunx claw-relay` again — it reconnects without relaunching Chrome.

## What It Does

Claw Relay sits between your AI agent and Chrome. The agent sends actions (navigate, click, read) via WebSocket — the relay enforces auth, permissions, rate limits, and site restrictions before forwarding to Chrome via CDP.

## Connect Your Agent

Use the MCP server for Claude Desktop, Copilot CLI, or any MCP client:

```json
{
  "mcpServers": {
    "claw-relay": {
      "command": "node",
      "args": ["mcp/claw-relay-mcp.js"],
      "env": {
        "RELAY_URL": "ws://localhost:9333",
        "RELAY_TOKEN": "your-token",
        "RELAY_AGENT_ID": "default"
      }
    }
  }
}
```

See [MCP docs](docs/mcp.md) for details.

## Chrome Extension

Optional — lets your agent use your normal Chrome instead of the dedicated window:

1. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
2. Click the toolbar icon on any tab to share it with the relay

## Configuration

Auto-generated `config.yaml` on first run. Key settings:

```yaml
agents:
  my-agent:
    token: "crly_..."           # auth token
    scopes: ["read", "navigate", "interact"]
    allowlist: ["github.com"]   # where the agent can go
    rateLimit: 30               # actions per minute

blocklist:
  - "*.bank.com"               # always blocked
```

## CLI Options

```
bunx claw-relay [options]

  --port <number>    Server port (default: 9333)
  --config <path>    Custom config path
  --no-chrome        Skip Chrome launch (assumes CDP on :9222)
```

## Security

- **Auth** — token + agent ID per connection
- **Scopes** — read, navigate, interact, execute
- **Allowlist/Blocklist** — per-agent URL restrictions
- **Rate limiting** — per agent, per minute
- **Audit log** — every action logged with timestamp

## Docs

| | |
|---|---|
| [Setup Guide](docs/setup.md) | Install, configure, launch |
| [MCP Server](docs/mcp.md) | Connect MCP clients |
| [Protocol](docs/protocol.md) | WebSocket API reference |
| [Dashboard](docs/dashboard.md) | Web UI for monitoring |
| [Tunnels](docs/tunnels.md) | Remote access |
| [Troubleshooting](docs/troubleshooting.md) | Common issues |

## License

MIT
