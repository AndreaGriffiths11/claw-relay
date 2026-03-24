# Privacy Policy — Claw Relay Chrome Extension

**Last updated:** March 18, 2026

## What the extension does

Claw Relay is a status dashboard that connects to a Claw Relay server — either your own self-hosted instance or Claw Relay Cloud. It displays relay health and connected AI agents.

## Data collected

The extension stores **three values** locally on your device using Chrome's `storage` API:

- **Relay server URL** — the address of your relay server (self-hosted or Claw Relay Cloud)
- **API key** — used to authenticate with your relay server
- **Agent ID** — identifies which AI agent to connect to

This data never leaves your browser. It is not transmitted to us, to Google, or to any third party.

## Data not collected

The extension does not collect, transmit, or store:

- Browsing history
- Personal information
- Cookies or tracking data
- Analytics or telemetry
- Any data from web pages you visit

## Network requests

The extension makes requests **only** to the relay server URL you configure. No other network requests are made.

## Third parties

No user data is shared with or sold to third parties.

## Contact

Questions? Open an issue at [github.com/AndreaGriffiths11/claw-relay](https://github.com/AndreaGriffiths11/claw-relay/issues).

---

## Relay Server — Local Audit Logging

The Claw Relay server logs agent actions locally (timestamps, agent IDs, action types, target URLs) for security auditing. These logs stay on your machine — no data is sent externally. The relay server has no analytics, telemetry, or phone-home behavior.
