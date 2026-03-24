<p align="center">
  <img src="assets/logo.png" alt="Claw Relay" width="300">
</p>

# Claw Relay

Give your AI agents a real browser.

## Quick Start

```bash
bunx claw-relay
```

That's it. Launches Chrome, starts the relay, generates config with random tokens.

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

Optional toolbar dashboard showing connection status and recent actions.

1. `chrome://extensions` → Developer mode → Load unpacked → select `extension/`
2. Click the icon for live status

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

## Advanced: Rust Implementation

Single-binary alternative with no runtime dependencies: [claw-relay-core](https://github.com/AndreaGriffiths11/claw-relay-core)

## License

MIT
