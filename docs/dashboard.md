# Dashboard

Claw Relay includes a built-in web dashboard for managing agents, viewing live connections, and browsing the audit log.

## Accessing the Dashboard

The dashboard starts automatically with the relay on port `9334`:

```
Dashboard running on http://localhost:9334
```

Open `http://localhost:9334` in your browser. You'll be prompted for the admin token.

## Configuration

Add to your `config.yaml`:

```yaml
dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

If `adminToken` is not set, it defaults to the first agent's token.

## Features

- **Live status** — connected agents, total actions today, server uptime
- **Agent management** — add, edit, and delete agents from the UI
- **Audit log** — every action color-coded by success/failure, auto-refreshes
- **Config sync** — changes write directly to `config.yaml` and take effect immediately

## Adding a New Agent

1. Click **+ Add Agent**
2. Enter an agent ID (e.g. `my-copilot`)
3. Click **Auto-generate** for a secure token, or enter your own
4. Select scopes:
   - **read** — snapshots and screenshots only
   - **navigate** — can open URLs
   - **interact** — can click, type, fill forms
   - **execute** — can run JavaScript (use with caution)
5. Add allowed sites (one per line, e.g. `github.com`)
6. Set a rate limit (actions per minute)
7. Click **Create Agent**

## Connecting an Agent

Once configured via the dashboard, agents connect via WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:9333');
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'the-token-from-dashboard',
    agent_id: 'my-copilot'
  }));
});
```

For remote agents, use a [tunnel](tunnels.md) and connect via `wss://your-tunnel-url/`.
