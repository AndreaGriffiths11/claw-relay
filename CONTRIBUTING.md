# Contributing to Claw Relay

Thanks for wanting to contribute! Here's how to get started.

## Quick Start

1. Fork the repo
2. Clone your fork
3. Create a branch from `main`:
   ```
   git checkout -b feat/your-thing
   ```
4. Install dependencies:
   ```bash
   cd relay-server && bun install
   ```
5. Test locally — start the relay, verify your changes work:
   ```bash
   cd relay-server && bun src/cli.ts
   ```
6. Open a PR against `main`

## Branch Naming

- `feat/` — new features
- `fix/` — bug fixes
- `docs/` — documentation only
- `refactor/` — code changes that don't add features or fix bugs

## PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Make sure it type-checks (`bunx tsc --noEmit`)
- Verify the relay starts cleanly (`bun src/cli.ts`)
- Describe what changed and why
- Include steps to test if it's not obvious

## Code Style

- **TypeScript** — strict mode, Bun runtime
- Zero new dependencies unless absolutely necessary (and discussed first)
- Dashboard is a TanStack React SPA in `relay-server/dashboard/`

## Architecture

```
relay-server/           # Bun/TypeScript
├── src/
│   ├── cli.ts          # CLI entry point (bunx claw-relay)
│   ├── index.ts        # WebSocket server, relay logic
│   ├── engine.ts       # Chrome integration via puppeteer-core (CDP)
│   ├── dashboard.ts    # HTTP dashboard server
│   ├── state.ts        # Connection state tracking
│   ├── auth.ts         # Config loading, authentication
│   ├── protocol.ts     # Message parsing, types
│   ├── permissions.ts  # Scope checking
│   ├── allowlist.ts    # URL allow/block logic
│   ├── rate-limiter.ts # Per-agent rate limiting
│   └── audit-logger.ts # Action logging
├── dashboard/          # TanStack React SPA
├── config.example.yaml
└── package.json

mcp/                    # MCP server for Claude Desktop, Copilot CLI, etc.
└── claw-relay-mcp.js

extension/              # Chrome Extension (Manifest V3)
├── manifest.json
├── popup.html
└── ...
```

## What We're Looking For

- New scopes or actions — extend the WebSocket protocol
- Dashboard improvements — better UI, new views, charts
- Engine integrations — support for browsers beyond Chrome
- Security hardening — better auth, encryption, sandboxing
- Documentation — guides, examples, tutorials
- Bug fixes — always welcome

## What to Avoid

- Don't add heavy dependencies for things that can be done with built-ins
- Don't change the WebSocket protocol without discussion (open an issue first)
- Don't commit secrets, tokens, or config files

## Need Help?

Open an issue. We don't bite. 🦞
