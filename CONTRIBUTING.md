# Contributing to Claw Relay

Thanks for wanting to contribute! Here's how to get started.

## Quick Start

1. Fork the repo
2. Clone your fork
3. Create a branch from `main`:
   ```
   git checkout -b feat/your-thing
   ```
4. Make changes inside `relay-server/` (Bun/TypeScript) or `relay-core/` (Rust):
   ```bash
   # Bun
   cd relay-server && bun install

   # Rust
   cd relay-core && cargo build
   ```
5. Test locally — start Chrome with debugging, run the relay, verify your changes work
6. Open a PR against `main`

## Branch Naming

- `feat/` — new features
- `fix/` — bug fixes
- `docs/` — documentation only
- `refactor/` — code changes that don't add features or fix bugs

## PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Make sure it compiles (`cargo check` for Rust, `bun src/index.ts` starts cleanly for TS)
- Describe what changed and why
- Include steps to test if it's not obvious

## Code Style

- **TypeScript** — strict mode, Bun runtime
- **Rust** — stable toolchain, `cargo clippy` clean
- Zero new dependencies unless absolutely necessary (and discussed first)
- Dashboard is a TanStack React SPA in `relay-server/dashboard/`

## Architecture

```
relay-server/           # Bun/TypeScript implementation
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
├── dashboard/          # TanStack React SPA
├── config.example.yaml
└── package.json

relay-core/             # Rust implementation
├── src/
│   ├── main.rs         # Entry point
│   ├── config.rs       # YAML config parsing
│   ├── auth.rs         # Authentication
│   ├── relay.rs        # WebSocket server
│   ├── dashboard.rs    # HTTP API + static serving
│   ├── permissions.rs  # Scope checking
│   ├── blocklist.rs    # URL pattern matching
│   ├── audit.rs        # Action logging
│   └── state.rs        # Shared state
└── Cargo.toml
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
