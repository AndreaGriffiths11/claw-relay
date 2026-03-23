---
name: claw-relay
description: Control a remote browser through Claw Relay. Use when you need to navigate authenticated websites, click buttons, fill forms, take screenshots, or read page content on a user's real browser — especially when the agent runs on a different machine (cloud, container, server) than the browser. Triggers on remote browser control, authenticated browsing, real browser, cookie-based access, browser relay.
---

# Claw Relay — Remote Browser Control

You control a real Chrome browser through a WebSocket relay. The browser runs on the user's machine with their real cookies and sessions. You run anywhere.

## Connection

Connect via WebSocket. Auth first, then send actions.

```javascript
const ws = new WebSocket('wss://<relay-url>');

// First message must be auth
ws.send(JSON.stringify({
  type: 'auth',
  token: '<agent-token>',
  agent_id: '<your-agent-id>'
}));
```

The relay URL and token are provided by the user or set as environment variables:
- `CLAW_RELAY_URL` — WebSocket URL (e.g. `wss://relay.example.com`)
- `CLAW_RELAY_TOKEN` — agent auth token
- `CLAW_RELAY_AGENT` — your agent identifier

## Actions

After auth succeeds, send actions as JSON:

| Action | Scope | Payload |
|--------|-------|---------|
| `snapshot` | `read` | `{"type": "snapshot"}` — returns accessibility tree |
| `screenshot` | `read` | `{"type": "screenshot"}` — returns base64 PNG via WebSocket |
| `click` | `interact` | `{"type": "click", "ref": "e5"}` |
| `type` | `interact` | `{"type": "type", "ref": "e3", "text": "hello"}` |
| `fill` | `interact` | `{"type": "fill", "ref": "e3", "text": "hello"}` |
| `press` | `interact` | `{"type": "press", "key": "Enter"}` |
| `hover` | `interact` | `{"type": "hover", "ref": "e2"}` |
| `select` | `interact` | `{"type": "select", "ref": "e7", "values": ["opt1"]}` |
| `navigate` | `navigate` | `{"type": "navigate", "url": "https://..."}` |
| `evaluate` | `execute` | `{"type": "evaluate", "js": "document.title"}` |
| `close` | `navigate` | `{"type": "close"}` |

## Responses

```json
{"type": "result", "action": "snapshot", "ok": true, "data": "...accessibility tree..."}
{"type": "result", "action": "screenshot", "ok": true, "data": "<base64-encoded-png>", "mimeType": "image/png"}
{"type": "error", "code": "permission_denied", "message": "Agent lacks 'interact' scope"}
{"type": "error", "code": "site_blocked", "message": "mail.google.com is blocked"}
```

## Workflow Pattern

1. **Snapshot first** — read the page structure before acting
2. **Find elements by ref** — the accessibility tree assigns refs (e.g. `e1`, `e5`) to interactive elements
3. **Act on refs** — click, type, fill using the ref from the snapshot
4. **Snapshot again** — verify the page changed as expected
5. **Repeat** — navigate → snapshot → act → verify

```
snapshot → find button ref → click ref → snapshot → verify
```

## Scopes (least privilege)

Request only what you need:

- **`read`** — snapshot, screenshot. Start here.
- **`interact`** — click, type, fill, hover, select. Adds the ability to change things.
- **`navigate`** — go to URLs. Can access any allowed site as the logged-in user.
- **`execute`** — run JavaScript on the page. Nuclear option. Avoid unless necessary.

## Security Constraints

- **Allowlist** — your agent can only access sites explicitly allowed in its config
- **Blocklist** — banking, email, and auth providers are always blocked regardless of allowlist
- **Rate limiting** — actions are rate-limited per agent (token bucket)
- **Audit log** — every action is logged with timestamps, agent ID, action, target, and result

## What Makes This Different

Local browser tools require agent and browser on the same machine. Claw Relay doesn't. Your agent runs anywhere — cloud, server, container — and controls the user's real browser remotely. Real cookies, real sessions, real logins. No headless browser, no fake profiles.

## Setup

Users set up the relay on their machine:

```bash
git clone https://github.com/AndreaGriffiths11/claw-relay.git
cd claw-relay && ./start.sh
```

Or use Claw Relay Cloud at [clawrelay.dev](https://clawrelay.dev) — no tunnels, no config.

## Common Tasks

### Read a page
```json
{"type": "navigate", "url": "https://github.com/notifications"}
// wait for response
{"type": "snapshot"}
```

### Fill and submit a form
```json
{"type": "snapshot"}
// find input ref from tree, e.g. e3
{"type": "fill", "ref": "e3", "text": "search query"}
{"type": "press", "key": "Enter"}
```

### Click a button
```json
{"type": "snapshot"}
// find button ref, e.g. e7
{"type": "click", "ref": "e7"}
```

## Error Handling

- `permission_denied` — you lack the required scope. Ask the user to upgrade your agent config.
- `site_blocked` — the target site is on the global blocklist. Cannot be overridden.
- `site_not_allowed` — the site isn't in your allowlist. Ask the user to add it.
- `rate_limited` — slow down. Wait and retry.
- `engine_error` — browser or CDP issue. The page may have navigated or the element may be stale. Re-snapshot and retry.
