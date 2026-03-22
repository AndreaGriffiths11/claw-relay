# WebSocket Protocol

Connect to `ws://localhost:9333` (configurable).

## Authentication

First message must be:

```json
{"type": "auth", "token": "your-token", "agent_id": "your-agent"}
```

## Actions

All actions accept an optional `request_id` field. If provided, the relay echoes it back in the response — use this to match responses to requests when sending concurrent actions.

| Action | Scope | Example |
|--------|-------|---------|
| `snapshot` | `read` | `{"type": "snapshot"}` |
| `screenshot` | `read` | `{"type": "screenshot"}` |
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

Success:
```json
{"type": "result", "action": "snapshot", "ok": true, "data": "...accessibility tree...", "request_id": "mcp-1"}
```

Screenshot (base64 tunneling):
```json
{"type": "result", "action": "screenshot", "ok": true, "data": "<base64-encoded-png>", "mimeType": "image/png", "request_id": "mcp-2"}
```

The `screenshot` action returns the full-page image as base64-encoded PNG data directly in the WebSocket response. No file paths, no local storage — the agent receives the raw image data it can decode or pass to a vision model.

Error:
```json
{"type": "error", "code": "permission_denied", "message": "Agent lacks 'interact' scope", "request_id": "mcp-1"}
{"type": "error", "code": "site_blocked", "message": "mail.google.com is blocked"}
```

The `request_id` field is optional. If omitted from the request, it won't appear in the response.

## Scopes

- **read** — snapshots, screenshots (passive observation)
- **navigate** — open URLs (subject to allowlist/blocklist)
- **interact** — click, type, fill, select, hover (active control)
- **execute** — run JavaScript on the page (full access — use with extreme caution)
