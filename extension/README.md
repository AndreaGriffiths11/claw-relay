# Claw Relay™ — Chrome Extension

Browser extension that connects your Chrome tabs to the Claw Relay server, enabling AI agents to automate your real browser tabs — including tabs where you're already logged in.

## What It Does

### Status Monitor
- Shows relay server health (online/offline)
- Displays connected agent info and recent actions
- Pause/resume health checks

### Tab Bridge (chrome.debugger)
- **Attach tabs** for AI agent control via the toolbar popup
- Executes CDP commands through `chrome.debugger` API
- Supports: snapshot, screenshot, click, fill, type, press, navigate, evaluate
- Implements the same ref-map system (`e0`, `e1`, `data-claw-ref`) as the main engine

## How It Works

1. Configure relay URL and token in Settings
2. Click **Connect** in the popup to open a WebSocket to the relay
3. Click **🔗 Attach This Tab** on any tab you want agents to control
4. The badge shows the number of attached tabs
5. Agents send actions through the relay → extension executes via CDP → results go back

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save relay URL, token, settings |
| `debugger` | Chrome DevTools Protocol access to attached tabs |
| `activeTab` | Know which tab is currently active |
| `tabs` | List and query tab info (title, favicon) |
| `<all_urls>` | Required for `chrome.debugger` to work on any site |

## Supported Actions

| Action | Description |
|---|---|
| `snapshot` | Accessibility tree with ref-mapped interactive elements |
| `screenshot` | Full-page PNG screenshot via CDP |
| `click` | Click element by ref or CSS selector |
| `fill` | Clear field and insert text |
| `type` | Type text character by character |
| `press` | Press a single key |
| `navigate` | Navigate to a URL |
| `evaluate` | Execute JavaScript and return result |

## Ref System

Matches the engine.ts ref system:
- Interactive roles: textbox, button, link, checkbox, radio, combobox, menuitem, tab, switch, slider, searchbox, option, listbox, menu, tree, treeitem, heading
- Sequential refs: `e0`, `e1`, `e2`...
- Injects `data-claw-ref` attributes on DOM nodes
- Output format: `[e0] button "Submit" (focused)`

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this `extension/` folder
4. Configure relay URL and token in the extension's Settings page

## Architecture Note

This PR implements the **extension side only**. The relay server does not yet route actions to the extension — that comes in a follow-up PR. The WebSocket connection and action handling are fully implemented and ready for relay-side integration.
