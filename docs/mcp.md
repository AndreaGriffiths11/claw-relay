# MCP Server

The `mcp/` directory contains a stdio-based MCP server that bridges any MCP-compatible client (GitHub Copilot CLI, Claude Desktop, etc.) to Claw Relay.

## Setup

```bash
cd mcp && bun install   # or npm install
```

## Tools

### Core

| Tool | Params | Description |
|------|--------|-------------|
| `browser_navigate` | `url`, `targetId?` | Navigate to a URL |
| `browser_snapshot` | `targetId?` | Get accessibility tree |
| `browser_screenshot` | `targetId?`, `fullPage?`, `element?`, `ref?`, `imageType?` | Take a screenshot |
| `browser_close` | `targetId?` | Close a tab |

### Interaction

| Tool | Params | Description |
|------|--------|-------------|
| `browser_click` | `ref?`, `selector?`, `targetId?`, `doubleClick?`, `button?`, `modifiers?`, `delayMs?` | Click element |
| `browser_hover` | `ref?`, `selector?`, `targetId?` | Hover over element |
| `browser_type` | `text`, `ref?`, `selector?`, `targetId?`, `slowly?`, `submit?` | Type text (appends) |
| `browser_fill` | `ref?`+`text?` or `fields[]`, `targetId?` | Fill input (replaces content) |
| `browser_press` | `key`, `targetId?`, `delayMs?` | Press a key |
| `browser_select` | `ref?`, `selector?`, `values[]`, `targetId?` | Select dropdown option |
| `browser_drag` | `startRef`, `endRef`, `targetId?` | Drag between elements |
| `browser_scroll_into_view` | `ref?`, `selector?`, `targetId?` | Scroll element into view |

### Execution

| Tool | Params | Description |
|------|--------|-------------|
| `browser_evaluate` | `js?`, `fn?`, `targetId?`, `ref?`, `timeoutMs?` | Run JavaScript in the page |
| `browser_wait` | `timeMs?`, `text?`, `textGone?`, `selector?`, `url?`, `loadState?`, `fn?`, `targetId?`, `timeoutMs?` | Wait for a condition |

### Monitoring

| Tool | Params | Description |
|------|--------|-------------|
| `browser_console` | `level?`, `clear?`, `targetId?` | Get console messages |
| `browser_network` | `filter?`, `clear?`, `targetId?` | Get network requests |

### Advanced

| Tool | Params | Description |
|------|--------|-------------|
| `browser_batch` | `actions[]`, `stopOnError?`, `targetId?` | Execute multiple actions in sequence |
| `browser_resize` | `width`, `height`, `targetId?` | Resize viewport |
| `browser_pdf` | `targetId?` | Generate PDF of current page |

> **Note:** The MCP server source (`mcp/claw-relay-mcp.js`) will be updated in a separate PR to implement the new tools. This documents the target API.

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

## Concurrent Requests

The MCP server includes a `request_id` field with every action sent to the relay. Responses carry the same `request_id` back, allowing the server to match results to the correct pending request even when multiple actions are in flight simultaneously.
