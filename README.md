# 🦀 Claw Relay

**Let AI agents use your authenticated browser sessions — securely.**

Claw Relay is a Chrome extension that bridges AI agents to your browser. Instead of sharing passwords or API keys, you share a *controlled session*. The agent sees what you see, clicks what you allow, and every action is logged.

## Why?

AI agents are powerful but blind. They can't log into your Cloudflare dashboard, navigate your AWS console, or fill out forms on sites that require authentication. Claw Relay fixes that by giving agents a supervised window into your browser.

## How It Works

1. **Install the extension** → Load as unpacked in Chrome
2. **Activate the relay** → Click the extension icon, toggle "Relay Active"
3. **Start the relay server** → `node relay/server.js`
4. **Connect your agent** → WebSocket to `ws://localhost:19222?role=agent&token=YOUR_TOKEN`
5. **Agent operates through you** → Snapshots, clicks, fills, navigates — all audited

## Setup

### 1. Load the Extension

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this `claw-relay` directory

### 2. Start the Relay Server

```bash
npm install ws
node relay/server.js
```

Or with a specific token:

```bash
CLAW_RELAY_TOKEN=mysecrettoken node relay/server.js
```

### 3. Connect an Agent

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:19222?role=agent&token=YOUR_TOKEN');

ws.on('open', () => {
  // Get a DOM snapshot
  ws.send(JSON.stringify({ type: 'snapshot' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  console.log(msg);
  // { type: 'snapshot_result', url: '...', title: '...', elements: [...] }
});
```

## Protocol

### Agent → Extension

| Message | Description |
|---------|-------------|
| `{"type": "snapshot"}` | Get structured DOM elements |
| `{"type": "click", "selector": "#btn"}` | Click an element |
| `{"type": "fill", "selector": "input#email", "value": "..."}` | Fill an input |
| `{"type": "select", "selector": "select#country", "value": "US"}` | Select an option |
| `{"type": "navigate", "url": "https://..."}` | Navigate to URL |
| `{"type": "evaluate", "script": "document.title"}` | Run JavaScript |
| `{"type": "status"}` | Get relay status |

### Extension → Agent

| Response | Fields |
|----------|--------|
| `snapshot_result` | `url`, `title`, `elements[]` |
| `action_result` | `success`, `action`, `target` |
| `eval_result` | `success`, `result` |
| `error` | `error` (message) |

### Snapshot Element Format

```json
{
  "ref": "e1",
  "role": "button",
  "text": "Submit",
  "label": "Submit form",
  "selector": "#submit-btn"
}
```

## Permission Scopes

Control what the agent can do:

| Scope | Allows |
|-------|--------|
| `read` | Snapshots only (always on) |
| `interact` | Click, fill, select |
| `navigate` | Change URLs |
| `execute` | Run arbitrary JS |
| `full` | Everything |

Default: `read` + `interact`

## Security

- **One-time auth tokens** — Shown in popup, required for agent connection
- **Permission scopes** — Granular control over what agents can do
- **Full audit log** — Every action logged with timestamp
- **Instant revoke** — One click to cut agent access
- **Local only** — WebSocket runs on localhost, never exposed externally

## Architecture

```
┌──────────┐     WebSocket      ┌──────────────┐     Chrome APIs     ┌─────────┐
│  Agent   │ ←──────────────→  │ Relay Server  │ ←─────────────────→ │Extension│
│(any LLM) │  ws://localhost   │  (Node.js)    │   chrome.runtime    │  (MV3)  │
└──────────┘    :19222         └──────────────┘                     └─────────┘
                                                                         │
                                                                    Content Script
                                                                         │
                                                                    ┌─────────┐
                                                                    │  Page   │
                                                                    │  DOM    │
                                                                    └─────────┘
```

## Development

This is an MVP. Planned improvements:

- [ ] Native messaging host (no separate server process)
- [ ] Multi-tab support
- [ ] Screenshot capture
- [ ] Cookie/header forwarding
- [ ] Session recording & replay
- [ ] OpenClaw integration as a browser profile

## License

MIT
