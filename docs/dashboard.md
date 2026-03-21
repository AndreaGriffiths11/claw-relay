# Dashboard

Claw Relay includes a built-in dashboard for managing agents, viewing live connections, and browsing the audit log.

## Access

The dashboard runs on port `9334`:

```
http://localhost:9334
```

Enter your admin token in the auth modal when prompted.

## Build

```bash
cd relay-server/dashboard
bun install
bun run build
```

`start.sh` builds automatically if `dashboard/dist/` doesn't exist.

## Configuration

```yaml
dashboard:
  port: 9334
  adminToken: "your-secret-admin-token"
```

## Pages

- **Overview** (`/`) — Connected agents, total actions, uptime
- **Agents** (`/agents`) — Add, edit, delete agents. Scope pills (read, interact, navigate, execute), online/offline status, allowlists, rate limits
- **Audit Log** (`/audit`) — Filterable, paginated, color-coded. Search, download, clear
- **Settings** (`/settings`) — Current config, version, logout

## Adding an Agent

1. Go to **Agents** → **+ Add Agent**
2. Set agent ID, generate or enter a token
3. Select scopes: `read`, `navigate`, `interact`, `execute`
4. Add allowed sites and rate limit
5. **Create Agent**

## Tech Stack

React 19, TanStack Router, TanStack Query, Vite, vanilla CSS, DM Sans font.
