# Troubleshooting

## Chrome Issues

| Problem | Fix |
|---------|-----|
| Chrome won't start | Another Chrome instance may be using the debug port. Kill it: `pkill -f "claw-relay/chrome-data"` then restart |
| Tiny/squished viewport | Restart the relay — the viewport fix requires a fresh server start. `Ctrl+C` then `npx claw-relay` |
| "Who's using Chrome?" dialog | The CLI uses `--user-data-dir` to skip this. If you see it, update to the latest version |
| Chrome window not visible | It may have launched off-screen. Kill and restart: `pkill -f "claw-relay/chrome-data" && npx claw-relay` |
| Not signed into GitHub/etc. | Sign in once in the Claw Relay Chrome window. Logins persist in `~/.claw-relay/chrome-data/` |
| Want to use your normal Chrome | Install the Chrome Extension (load unpacked from `extension/`) — no separate window needed |

## Connection Issues

| Problem | Fix |
|---------|-----|
| `502` from tunnel | The relay server isn't running. Start it with `npx claw-relay` |
| `Connection refused` on port 9333 | Relay isn't running, or `host` is `"127.0.0.1"` and you're connecting remotely. Change to `"0.0.0.0"` in config |
| `EADDRINUSE` on port 9333 | Old instance still running. Kill it: `lsof -ti:9333 \| xargs kill` |
| Tunnel URL stopped working | Quick tunnels are ephemeral. Restart for a new URL, or use a named tunnel |
| `Duplicate agent ID rejected` | Another session is connected with the same `agent_id`. Disconnect it or use a different ID |

## Config Issues

| Problem | Fix |
|---------|-----|
| `DUPLICATE_KEY` YAML error | You have two `host:` lines (or similar). Replace the line, don't add a second one |

## MCP Issues

| Problem | Fix |
|---------|-----|
| MCP "Connection closed" in Copilot CLI | Relay WebSocket failed. Check URL/token. Test standalone: `CLAW_RELAY_URL=... CLAW_RELAY_TOKEN=... node mcp/claw-relay-mcp.js` |
| MCP tools return "Not connected" | WebSocket hasn't connected yet. Auto-retries — wait a moment |

## Dashboard Issues

| Problem | Fix |
|---------|-----|
| Dashboard auth modal won't dismiss | Clear localStorage for `localhost:9334` or open in incognito |
