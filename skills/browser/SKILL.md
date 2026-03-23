---
name: claw-relay
description: Control a remote browser through Claw Relay. Use when you need to navigate authenticated websites, click buttons, fill forms, take screenshots, or read page content on a user's real browser — especially when the agent runs on a different machine (cloud, container, server) than the browser. Triggers on remote browser control, authenticated browsing, real browser, cookie-based access, browser relay.
---

# Claw Relay — Remote Browser Control

You control a real Chrome browser on the user's machine through MCP tools. The browser has their real cookies and sessions. You run anywhere — cloud, server, container.

**Use the MCP tools below. Do NOT write WebSocket code, HTTP requests, or any custom connection logic.**

## MCP Tools

| Tool | What it does |
|------|-------------|
| `browser_navigate` | Navigate the browser to a URL |
| `browser_snapshot` | Get the accessibility tree — returns element refs (e.g. `e1`, `e5`) for interacting with the page. **Call this first.** |
| `browser_screenshot` | Take a PNG screenshot of the current page |
| `browser_click` | Click an element by ref from snapshot |
| `browser_type` | Type text into an input element (appends to existing text) |
| `browser_fill` | Fill an input element, replacing any existing content |
| `browser_press` | Press a keyboard key (`Enter`, `Tab`, `Escape`, `ArrowDown`, etc.) |
| `browser_hover` | Hover over an element — triggers hover menus and tooltips |
| `browser_select` | Select options from a dropdown by ref and values |
| `browser_evaluate` | Run JavaScript in the browser page. Use sparingly — prefer snapshot and click. |
| `browser_close` | Close the current browser tab |

## Workflow

1. **Navigate** — `browser_navigate` to the target URL
2. **Snapshot** — `browser_snapshot` to read the page structure and get element refs
3. **Act** — use `browser_click`, `browser_fill`, `browser_type`, etc. with refs from the snapshot
4. **Verify** — `browser_snapshot` again to confirm the page changed as expected
5. **Repeat** as needed

```
navigate → snapshot → find ref → act → snapshot → verify
```

### Example: Search GitHub

1. `browser_navigate` → `https://github.com`
2. `browser_snapshot` → find the search input ref (e.g. `e3`)
3. `browser_fill` with ref `e3` and text `"claw-relay"`
4. `browser_press` with key `Enter`
5. `browser_snapshot` → read the results

### Example: Click a button

1. `browser_snapshot` → find the button ref (e.g. `e7`)
2. `browser_click` with ref `e7`
3. `browser_snapshot` → verify the action happened

## Security Constraints

- **Allowlist** — your agent can only access sites explicitly allowed in its config
- **Blocklist** — banking, email, and auth providers are always blocked regardless of allowlist
- **Rate limiting** — actions are rate-limited per agent
- **Audit log** — every action is logged with agent ID, action, target, and result

## What Makes This Different

Local browser tools require agent and browser on the same machine. Claw Relay doesn't. Your agent runs anywhere and controls the user's real browser remotely — real cookies, real sessions, real logins. No headless browser, no fake profiles.
