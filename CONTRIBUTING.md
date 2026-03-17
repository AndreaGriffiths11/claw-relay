# Contributing to Claw Relay

Thanks for wanting to contribute! Here's how to get started.

## Quick Start

1. **Fork** the repo
2. **Clone** your fork
3. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/your-thing
   ```
4. **Make changes** inside `relay-server/`:
   ```bash
   cd relay-server
   npm install
   npx tsc          # must compile clean
   ```
5. **Test locally** — start Chrome with debugging, run the relay, verify your changes work
6. **Open a PR** against `main`

## Branch Naming

- `feat/` — new features
- `fix/` — bug fixes
- `docs/` — documentation only
- `refactor/` — code changes that don't add features or fix bugs

## PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Make sure TypeScript compiles (`npx tsc`)
- Describe what changed and why
- Include steps to test if it's not obvious

## Code Style

- TypeScript, strict mode
- Zero new npm dependencies unless absolutely necessary (and discussed first)
- Node built-in modules preferred over third-party packages
- Dashboard UI is inline HTML — keep it in template strings, no build tools

## Architecture

```
relay-server/
├── src/
│   ├── index.ts        # WebSocket server, main entry
│   ├── dashboard.ts    # HTTP dashboard server
│   ├── state.ts        # Connection state tracking
│   ├── auth.ts         # Config loading, authentication
│   ├── protocol.ts     # Message parsing, types
│   ├── permissions.ts  # Scope checking
│   ├── allowlist.ts    # URL allow/block logic
│   ├── rate-limiter.ts # Per-agent rate limiting
│   ├── audit-logger.ts # Action logging
│   └── engine.ts       # agent-browser integration
├── config.example.yaml
└── package.json
```

## What We're Looking For

- **New scopes or actions** — extend the WebSocket protocol
- **Dashboard improvements** — better UI, new views, charts
- **Engine integrations** — support for browsers beyond Chrome
- **Security hardening** — better auth, encryption, sandboxing
- **Documentation** — guides, examples, tutorials
- **Bug fixes** — always welcome

## What to Avoid

- Don't add heavy dependencies for things that can be done with Node built-ins
- Don't change the WebSocket protocol without discussion (open an issue first)
- Don't commit secrets, tokens, or config files

## Need Help?

Open an issue. We don't bite. 🦞
