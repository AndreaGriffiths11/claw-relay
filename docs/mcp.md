# MCP Server

The `mcp/` directory contains a stdio-based MCP server that bridges any MCP-compatible client (GitHub Copilot CLI, Claude Desktop, etc.) to Claw Relay.

## Setup

```bash
cd mcp && npm install
```

## Tools

| Tool | Params | Description |
|------|--------|-------------|
| `browser_navigate` | `url` | Navigate to a URL |
| `browser_click` | `ref` | Click element by ref |
| `browser_type` | `ref`, `text` | Type text into element (appends) |
| `browser_fill` | `ref`, `text` | Fill input (replaces content) |
| `browser_press` | `key` | Press a key (Enter, Tab, etc.) |
| `browser_snapshot` | — | Get accessibility tree |
| `browser_screenshot` | — | Take a screenshot |

## Usage with Copilot

**Local agent (same machine as relay):**

```bash
copilot --additional-mcp-config '{"mcpServers":{"claw-relay":{"command":"node","args":["path/to/claw-relay/mcp/claw-relay-mcp.js"],"env":{"CLAW_RELAY_URL":"ws://localhost:9333","CLAW_RELAY_AGENT":"copilot","CLAW_RELAY_TOKEN":"your-token"}}}}'
```

**Remote agent (different machine):**

```bash
copilot --additional-mcp-config '{"mcpServers":{"claw-relay":{"command":"node","args":["path/to/claw-relay/mcp/claw-relay-mcp.js"],"env":{"CLAW_RELAY_URL":"wss://relay.yourdomain.com/","CLAW_RELAY_AGENT":"copilot","CLAW_RELAY_TOKEN":"your-token"}}}}'
```

Or in a config file (`~/.copilot/mcp-config.json`):

```json
{
  "mcpServers": {
    "claw-relay": {
      "command": "node",
      "args": ["path/to/claw-relay/mcp/claw-relay-mcp.js"],
      "env": {
        "CLAW_RELAY_URL": "ws://localhost:9333",
        "CLAW_RELAY_TOKEN": "your-token",
        "CLAW_RELAY_AGENT": "copilot"
      }
    }
  }
}
```

> For remote agents, replace `ws://localhost:9333` with your tunnel URL (e.g. `wss://relay.yourdomain.com/`). See [Tunnels](tunnels.md).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAW_RELAY_URL` | Yes | WebSocket URL of the Claw Relay server |
| `CLAW_RELAY_TOKEN` | Yes | Auth token matching relay config |
| `CLAW_RELAY_AGENT` | No | Agent ID (default: `copilot`) |
