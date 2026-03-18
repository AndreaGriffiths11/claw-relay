# relay-core — Rust Implementation

A drop-in Rust replacement for the Bun relay-server. Same config.yaml format, same WebSocket protocol, same API endpoints.

## Build

```bash
cd relay-core
cargo build --release
```

Binary will be at `target/release/claw-relay-core`.

## Run

```bash
# Use the same config.yaml as the Bun version
./target/release/claw-relay-core ../relay-server/config.yaml

# Or without args (defaults to ../relay-server/config.yaml)
./target/release/claw-relay-core
```

## What It Does

- **WebSocket server** on `server.port` — handles agent auth, permission checks, rate limiting, blocklist/allowlist, and forwards actions to agent-browser via CLI
- **Dashboard HTTP server** on `dashboard.port` — REST API for managing agents, viewing audit logs, and serving the TanStack dashboard UI
- **Audit logging** — append-only JSONL file + optional stdout
- **Config hot-reload** — agent CRUD writes back to config.yaml atomically

## API Endpoints

All API routes require `?token=<adminToken>` or `Authorization: Bearer <adminToken>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth) |
| GET | `/api/status` | Connected agents + uptime |
| GET | `/api/agents` | List agents (tokens redacted) |
| POST | `/api/agents` | Add agent |
| PUT | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |
| GET | `/api/audit` | Recent audit entries |
| DELETE | `/api/audit` | Clear audit log |
| GET | `/api/audit/download` | Download audit as JSON |
| GET | `/api/config` | Current config (tokens redacted) |

## WebSocket Protocol

1. Connect to `ws://host:port/`
2. Send auth: `{ "type": "auth", "token": "...", "agent_id": "..." }`
3. Receive: `{ "type": "result", "action": "auth", "ok": true }`
4. Send actions: `{ "type": "snapshot" }`, `{ "type": "click", "ref": "e5" }`, etc.
5. Receive results or errors

## Dependencies

tokio, axum, serde, serde_json, serde_yaml, tower-http, sha2, chrono, tracing
