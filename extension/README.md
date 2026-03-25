# Claw Relay — Browser Extension

Status dashboard for your browser toolbar. Shows connection status, recent agent actions, and relay health.

> **Chrome Web Store submission is pending review.** In the meantime, you can install manually (see below).

The extension connects to your local relay server and bridges your existing Chrome tabs to your AI agent.

Works with **Chrome**, **Microsoft Edge**, and any Chromium-based browser.

## Download

**Option A:** Clone the whole repo:

```bash
git clone https://github.com/AndreaGriffiths11/claw-relay.git
```

**Option B:** Download just the `extension/` folder from GitHub — click **Code → Download ZIP**, then extract the `extension/` directory.

## Install

### Chrome
1. Go to `chrome://extensions`

### Microsoft Edge
1. Go to `edge://extensions`

### Then (both browsers):
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder (the one containing `manifest.json`)
5. The Claw Relay extension should now appear in your extensions list

> **Tip:** Pin it to your toolbar — click the puzzle piece icon in Chrome's toolbar, then the pin icon next to Claw Relay.

## Setup

1. Click the **Claw Relay** icon in your toolbar
2. Enter your relay server URL and API key (get these from your relay server config or [clawrelay.dev/dashboard](https://clawrelay.dev/dashboard))
3. Click **Save**
4. The badge should show **ON** when connected to the relay server

## Updating

1. Pull the latest changes:
   ```bash
   cd claw-relay
   git pull origin main
   ```
2. Go to `chrome://extensions`
3. Click the **refresh icon** (↻) on the Claw Relay extension card
4. Done — no need to remove and re-add

## Troubleshooting

| Problem | Fix |
|---|---|
| Extension won't load | Make sure you selected the `extension/` folder (not the repo root). Check that `manifest.json` is directly inside the folder you picked. |
| Badge shows **OFF** | Relay server isn't running or URL/key is wrong. Open the popup and verify your settings. Check that the relay server is reachable. |
| Badge disappears | The service worker may have gone idle. Click the extension icon to wake it up. |
| Changes not reflecting | Hit the refresh icon on `chrome://extensions` after pulling updates. |
| Permission errors | Make sure the host permissions in `manifest.json` match your relay server URL. |
ifest.json` match your relay server URL. |
permissions in `manifest.json` match your relay server URL. |
