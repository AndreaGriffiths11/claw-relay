# WebSocket Protocol

Connect to `ws://localhost:9333` (configurable).

## Authentication

First message must be:

```json
{"type": "auth", "token": "your-token", "agent_id": "your-agent"}
```

## Actions

All actions accept an optional `request_id` field. If provided, the relay echoes it back in the response — use this to match responses to requests when sending concurrent actions.

| Action | Required Fields | Optional Fields | Description |
|--------|----------------|-----------------|-------------|
| `auth` | `token`, `agent_id` | | Authenticate |
| `navigate` | `url` | `targetId` | Navigate to URL (creates tab if none exist) |
| `snapshot` | | `targetId` | Get accessibility tree |
| `screenshot` | | `targetId`, `fullPage`, `element`, `ref`, `imageType` | Capture screenshot |
| `click` | | `ref` or `selector`, `targetId`, `doubleClick`, `button`, `modifiers`, `delayMs` | Click element |
| `hover` | | `ref` or `selector`, `targetId` | Hover element |
| `type` | `text` | `ref` or `selector`, `targetId`, `slowly`, `submit` | Type text |
| `fill` | | `ref`+`text` OR `fields[]`, `targetId` | Fill input(s) |
| `press` | `key` | `targetId`, `delayMs` | Press keyboard key |
| `select` | | `ref` or `selector`, `values[]`, `targetId` | Select dropdown option |
| `evaluate` | `js` or `fn` | `targetId`, `ref`, `timeoutMs` | Execute JavaScript |
| `drag` | `startRef`, `endRef` | `targetId` | Drag between elements |
| `scrollIntoView` | | `ref` or `selector`, `targetId` | Scroll element into view |
| `wait` | | `timeMs`, `text`, `textGone`, `selector`, `url`, `loadState`, `fn`, `targetId`, `timeoutMs` | Wait for condition |
| `resize` | `width`, `height` | `targetId` | Resize viewport |
| `batch` | `actions[]` | `stopOnError`, `targetId` | Execute multiple actions |
| `console` | | `level`, `clear`, `targetId` | Get console messages |
| `network` | | `filter`, `clear`, `targetId` | Get network requests |
| `pdf` | | `targetId` | Generate PDF |
| `close` | | `targetId` | Close tab |

## Responses

All responses include `targetId` for tab tracking:

```json
{
  "type": "result",
  "action": "navigate",
  "ok": true,
  "data": "Navigated to https://example.com",
  "targetId": "CFFA23C7D35DB41228C23862C93CBCAE",
  "request_id": "optional-correlation-id"
}
```

Screenshot (base64 tunneling):
```json
{"type": "result", "action": "screenshot", "ok": true, "data": "<base64-encoded-png>", "mimeType": "image/png", "targetId": "..."}
```

Error:
```json
{"type": "error", "code": "permission_denied", "message": "Agent lacks 'interact' scope", "request_id": "mcp-1"}
{"type": "error", "code": "site_blocked", "message": "mail.google.com is blocked"}
```

The `request_id` field is optional. If omitted from the request, it won't appear in the response.

## targetId

Every response includes a `targetId` — the Chrome tab's internal ID. Pass it back in subsequent actions to pin to the same tab. Without it, the relay uses the most recent browsable tab.

## Element Resolution

Actions that target elements accept either:
- `ref` — accessibility node ID or aria label from a `snapshot`
- `selector` — CSS selector

If both are provided, `selector` takes priority.

## Scopes

- **read** — snapshots, screenshots, console, network (passive observation)
- **navigate** — open URLs, close tabs (subject to allowlist/blocklist)
- **interact** — click, type, fill, select, hover, drag, scroll (active control)
- **execute** — run JavaScript on the page (full access — use with extreme caution)

## Batch Actions

Execute multiple actions in sequence with a single message:

```json
{
  "type": "batch",
  "actions": [
    { "type": "click", "ref": "Login" },
    { "type": "fill", "ref": "Username", "text": "user@example.com" },
    { "type": "fill", "ref": "Password", "text": "secret" },
    { "type": "click", "ref": "Submit" }
  ],
  "stopOnError": true
}
```

When `stopOnError` is `true`, execution halts on the first failed action. The response includes results for all executed actions.

## Wait Conditions

The `wait` action supports multiple condition types:

```json
{ "type": "wait", "timeMs": 2000 }
{ "type": "wait", "text": "Welcome back" }
{ "type": "wait", "textGone": "Loading..." }
{ "type": "wait", "selector": "#results" }
{ "type": "wait", "loadState": "networkidle" }
{ "type": "wait", "url": "/dashboard" }
```

Use `timeoutMs` to cap how long the relay waits before returning an error (default varies by condition type).

## Heartbeat

The relay server sends `{"type": "ping"}` every 30 seconds. Clients **must** respond with `{"type": "pong"}` within 90 seconds or the connection will be closed as stale.

```json
// Server → Client
{"type": "ping"}

// Client → Server (respond within 90s)
{"type": "pong"}
```
