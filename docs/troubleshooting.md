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
