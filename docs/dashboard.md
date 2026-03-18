# Dashboard

Claw Relay includes a built-in React SPA dashboard for managing agents, viewing live connections, and browsing the audit log.

## Accessing the Dashboard

The dashboard starts automatically with the relay on port `9334`:

```
Dashboard running on http://localhost:9334
```

Open `http://localhost:9334` in your browser. You'll be prompted for the admin token.

You can also pass the token as a URL parameter: `http://localhost:9334?token=your-token`

## Building the Dashboard

The dashboard is a TanStack Router + TanStack Query React app that builds to static files.

**Automatic:** `start.sh` builds the dashboard automatically if `dashboard/dist/` doesn't exist.

**Manual:**
```bash
cd relay-server/dashboard
bun install
bun run build
```

**Development mode** (with hot reload):
```bash
cd relay-server/dashboard
bun run dev
```
The dev server proxies API calls to `http://localhost:9334`.

## Configuration

Add to your `config.yaml`:

```yaml
dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

If `adminToken` is not set, it defaults to the first agent's token.

## Pages

### Overview (`/`)
Live stats — connected agents, total actions, server uptime, and quick status cards for each registered agent.

### Agents (`/agents`)
Full agent management — add, edit, and delete agents. Each agent card shows:
- Connection status (online/offline)
- Scope pills (read=blue, interact=green, navigate=orange, execute=red)
- Allowlist, rate limit, redacted token
- Last action timestamp

### Audit Log (`/audit`)
Filterable, paginated audit log with color-coded rows (green=success, red=error). Supports:
- Text search across agent, action, and target fields
- Status filter (all/success/errors)
- Download as JSON
- Clear log

### Settings (`/settings`)
View current configuration, dashboard info, version, and logout.

## Adding a New Agent

1. Go to the **Agents** page
2. Click **+ Add Agent**
3. Enter an agent ID (e.g. `my-copilot`)
4. Click **Auto-generate** for a secure token, or enter your own
5. Select scopes:
   - **read** — snapshots and screenshots only
   - **navigate** — can open URLs
   - **interact** — can click, type, fill forms
   - **execute** — can run JavaScript (use with caution)
6. Add allowed sites (one per line, e.g. `github.com`)
7. Set a rate limit (actions per minute)
8. Click **Create Agent**

## Tech Stack

- **React 19** with TypeScript
- **TanStack Router** for client-side routing
- **TanStack Query** for data fetching with auto-refresh (status every 5s, audit every 10s)
- **Vite** for building
- **Vanilla CSS** — no Tailwind or CSS framework dependencies
- **DM Sans** + **Instrument Serif** fonts

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
