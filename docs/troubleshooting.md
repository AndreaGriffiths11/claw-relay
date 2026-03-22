# Troubleshooting

| Problem | Fix |
|---------|-----|
| `DUPLICATE_KEY` YAML error | You have two `host:` lines (or similar). Replace the line, don't add a second one |
| Chrome won't start with debugging | Quit Chrome completely first (Cmd+Q). The debug port can't bind while Chrome is running |
| `DevTools remote debugging requires a non-default data directory` | Add `--user-data-dir=/tmp/chrome-debug` to your Chrome launch command |
| `502` from tunnel | The relay server isn't running. Start it with `bun src/index.ts config.yaml` |
| `Connection refused` on port 9333 | Either the relay isn't running, or `host` is `"127.0.0.1"` and you're connecting remotely. Change to `"0.0.0.0"` |
| `EADDRINUSE` on port 9333 | Old instance still running. Kill it: `lsof -ti:9333 \| xargs kill` |
| Tunnel URL stopped working | Quick tunnels are ephemeral. Restart `cloudflared tunnel` for a new URL |
| `agent-browser connect` errors | Make sure Chrome is running with `--remote-debugging-port=9222` |
| `bun: command not found` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |
| Dashboard auth modal won't dismiss | Clear localStorage for `localhost:9334` or open in incognito |
| MCP server shows "Connection closed" in Copilot CLI | The relay WebSocket connection failed. Check that the relay is running and the URL/token are correct. Run the MCP server standalone to see the error: `CLAW_RELAY_URL=... CLAW_RELAY_TOKEN=... node mcp/claw-relay-mcp.js` |
| MCP tools return "Not connected" | The WebSocket connection hasn't completed yet. The MCP server will auto-retry — wait a moment and try again |
| `Duplicate agent ID rejected` | Another session is already connected with the same `agent_id`. Disconnect the other one or use a different agent ID |
| Named tunnel returns 530 | The `cloudflared tunnel run` command isn't running. Start it: `cloudflared tunnel run --url http://localhost:9333 claw-relay` |
