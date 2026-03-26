# Privacy Policy — Claw Relay

**Last updated:** March 25, 2026

Claw Relay has two components: a **Chrome extension** and a **relay server**. Both are designed to keep your data local.

---

## Chrome Extension

### What it does

The extension connects your browser to a self-hosted Claw Relay server. It uses `chrome.debugger` to attach to tabs and execute Chrome DevTools Protocol (CDP) commands — this is how your AI agent can view and interact with pages in your normal browser session.

### What it stores

Three values in Chrome's local `storage` API, never transmitted externally:

- **Relay server URL** — address of your self-hosted relay server
- **Token** — authenticates with your relay server
- **Agent ID** — identifies which AI agent to connect to

### What it doesn't collect

- Browsing history, cookies, or personal information
- Analytics or telemetry
- Data from pages you visit (beyond what the relay server requests via CDP)

### Network requests

The extension connects **only** to the relay server URL you configure. No other network requests are made.

---

## Relay Server

### What it does

The relay server is self-hosted — it runs on your machine. It bridges WebSocket connections between your AI agent and the Chrome extension, passing:

- **Actions** — click, type, navigate, and other browser commands
- **Screenshots** — page captures returned to the agent
- **Accessibility trees** — structural page data for the agent to understand content

All of this data flows through your local server. Nothing is sent to external services.

### Audit logging

The server logs agent actions locally (timestamps, agent IDs, action types, target URLs) for security auditing. Logs stay on your machine.

### No telemetry

The relay server has no analytics, no telemetry, and no phone-home behavior. It makes zero outbound network requests.

---

## Third parties

No user data is shared with or sold to third parties.

## Contact

Questions? Open an issue at [github.com/AndreaGriffiths11/claw-relay](https://github.com/AndreaGriffiths11/claw-relay/issues).
