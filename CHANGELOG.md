# Changelog
## Unreleased
- chore(deps): bump @tanstack/react-router from 1.168.8 to 1.168.10 in /relay-server/dashboard ([#80](https://github.com/AndreaGriffiths11/claw-relay/pull/80)) — 2026-04-07
- chore(deps): bump hono from 4.12.9 to 4.12.11 in /relay-server ([#74](https://github.com/AndreaGriffiths11/claw-relay/pull/74)) — 2026-04-07
- chore(deps): bump hono from 4.12.9 to 4.12.11 ([#76](https://github.com/AndreaGriffiths11/claw-relay/pull/76)) — 2026-04-07
- chore(deps): bump playwright-core from 1.58.2 to 1.59.1 ([#75](https://github.com/AndreaGriffiths11/claw-relay/pull/75)) — 2026-04-07
- chore(deps): bump @hono/node-server from 1.19.11 to 1.19.12 ([#72](https://github.com/AndreaGriffiths11/claw-relay/pull/72)) — 2026-04-07
- chore(deps): bump @hono/node-server from 1.19.11 to 1.19.12 in /relay-server ([#79](https://github.com/AndreaGriffiths11/claw-relay/pull/79)) — 2026-04-07
- chore(deps): bump playwright-core from 1.58.2 to 1.59.1 in /relay-server ([#78](https://github.com/AndreaGriffiths11/claw-relay/pull/78)) — 2026-04-07
- chore(deps-dev): bump @types/node from 25.5.0 to 25.5.2 in /relay-server ([#71](https://github.com/AndreaGriffiths11/claw-relay/pull/71)) — 2026-04-07
- chore(deps-dev): bump vite from 6.4.1 to 6.4.2 in /relay-server/dashboard ([#81](https://github.com/AndreaGriffiths11/claw-relay/pull/81)) — 2026-04-07
- fix: scan all browser contexts for tabs ([#69](https://github.com/AndreaGriffiths11/claw-relay/pull/69)) — 2026-03-31
- feat: denial tracking for agent permissions ([#68](https://github.com/AndreaGriffiths11/claw-relay/pull/68)) — 2026-03-31
- fix: add openssl and curl to Docker image ([#67](https://github.com/AndreaGriffiths11/claw-relay/pull/67)) — 2026-03-30
- chore(deps): bump @tanstack/react-router from 1.168.4 to 1.168.8 in /relay-server/dashboard ([#66](https://github.com/AndreaGriffiths11/claw-relay/pull/66)) — 2026-03-30
- docs: add Chrome Web Store install link ([#65](https://github.com/AndreaGriffiths11/claw-relay/pull/65)) — 2026-03-29
- fix: update Railway deploy button URL ([#64](https://github.com/AndreaGriffiths11/claw-relay/pull/64)) — 2026-03-28
- docs: add Deploy on Railway button ([#62](https://github.com/AndreaGriffiths11/claw-relay/pull/62)) — 2026-03-28
- feat: add /health endpoint ([#63](https://github.com/AndreaGriffiths11/claw-relay/pull/63)) — 2026-03-28
- feat: Dockerfile + Railway template support ([#61](https://github.com/AndreaGriffiths11/claw-relay/pull/61)) — 2026-03-27
- feat: implement all 8 missing MCP tools ([#60](https://github.com/AndreaGriffiths11/claw-relay/pull/60)) — 2026-03-27
- docs: add Agent Skills section to README ([#59](https://github.com/AndreaGriffiths11/claw-relay/pull/59)) — 2026-03-27
- chore: update npm package name to @acolombiadev/claw-relay ([#58](https://github.com/AndreaGriffiths11/claw-relay/pull/58)) — 2026-03-26


## v1.0.0 — The Open-Source Release

This is the first public release of Claw Relay. What follows is the story of how it got here.

Before this release, 199 commits were squashed into a clean starting point. This changelog is the permanent record of that evolution — written for anyone who finds this repo and wonders how a browser relay server ended up at this particular set of trade-offs.

---

## The Journey

Claw Relay started as a Chrome extension paired with a relay server: a way for AI agents to control a browser remotely over WebSocket. The idea was simple. The implementation went through five distinct phases, three runtime migrations, two browser automation libraries, and one failed language experiment before landing here.

The short version: we tried to make it fast with Rust, learned the bottleneck was Chrome itself (not the server), simplified back to Node.js, fought Bun's WebSocket bugs, switched to Playwright, and spent the last stretch hardening security after finding two critical scope bypasses.

---

## Phase 1: MVP

**Commits `dcf7c4c` → `~8fcb099`**

The original concept: a Chrome extension captures the browser state, a relay server bridges it to AI agents over WebSocket.

- Built the Chrome extension + relay server architecture
- Hand-drawn architecture diagrams (some survived into docs)
- Dashboard UI for managing connected agents
- First security hardening pass — auth tokens, basic access control
- Proved the concept worked: an AI agent could navigate, click, and read pages through the relay

This phase answered the question "can this work?" — yes, clearly.

## Phase 2: The Bun + Rust Era

**Commits `5d15bb6` → `~5f3de64`**

The ambition phase. Two big bets: migrate to Bun for faster server startup, and rewrite the core in Rust for lower latency.

- **Bun migration** — moved from Node.js to Bun runtime
- **Rust implementation (`relay-core`)** — parallel Rust server for browser control
- **TanStack Router dashboard** — rewrote the admin dashboard with TanStack Router
- **MCP server bridge** — enabled Copilot CLI and Claude to connect via Model Context Protocol
- **Security audit rounds** — auth rate limiting, path traversal protection, timing-safe authentication
- **Carmack-style code quality pass** — tightened error handling, removed dead code, simplified control flow
- **Unit test suite** — first real test coverage

**Why Rust was tried:** The hypothesis was that relay server compute was adding latency to browser control. We wanted sub-10ms relay overhead.

**What we learned:** Chrome's CDP (Chrome DevTools Protocol) round-trips take 50–500ms. The relay server adds ~1ms. Rust would have shaved microseconds off a millisecond. The bottleneck was never the server — it was Chrome itself.

The Rust code worked. It just didn't matter. This is the phase where we learned to measure before optimizing.

## Phase 3: Simplification

**Commits `02f3095` → `~0944a3b`**

Armed with the knowledge that server performance wasn't the bottleneck, we started removing complexity.

- **Removed `agent-browser`**, switched to `puppeteer-core` for direct CDP control
- **Rust core extracted** to a separate private repo (preserved, not deleted — just not needed here)
- **The Chrome profile saga:**
  - Started with a dedicated Chrome profile (isolated but inconvenient)
  - Tried using the user's own profile (convenient but caused session conflicts)
  - Went back to a dedicated profile (isolation wins)
- **CDP-based window sizing** — set viewport dimensions through the protocol instead of window management hacks
- **SSRF redirect protection** — blocked open redirect chains that could bypass URL allowlists

## Phase 4: The Playwright Migration

**Commits `312ba47` → `~dbf0d46`**

The forced migration. Bun's WebSocket implementation had a subtle bug: CDP connections would hang under load, with no error, no timeout, just silence.

- **Bun → Node.js/tsx** — back to Node, using tsx for TypeScript execution
- **Puppeteer → Playwright** — Playwright's CDP client handled connection lifecycle more reliably
- **npm publish prep** — bundled with tsup for clean package distribution

**Why this happened:** Bun's WebSocket implementation caused CDP connection hangs that were nearly impossible to debug. No errors thrown, no timeouts fired — the connection just stopped responding. Playwright's CDP client had more robust connection state management.

Three runtime migrations total: Node → Bun → Node. Sometimes the boring choice is the right choice.

## Phase 5: Polish & Security

**Commits `e81ed86` → `bba3fb2`**

The "make it actually safe to ship" phase.

- **Ref map system** — `[e0]`, `[e1]` refs instead of raw CDP node IDs. Stable element targeting that survives DOM mutations and is readable by both humans and agents.
- **Chrome extension tab bridge** — `chrome.debugger` API for controlling the user's active tab without a separate Chrome instance
- **OpenClaw-native skill** (`relay-client.cjs`) — direct integration for OpenClaw agents via exec, no MCP required
- **Dashboard disconnect button** — sounds minor, was repeatedly requested
- **Two critical scope bypasses fixed:**
  - **Batch bypass** — agents could bundle disallowed actions inside a batch request, circumventing per-action scope checks
  - **wait+fn bypass** — the `wait` action with a `fn` parameter could execute arbitrary JavaScript, ignoring the `execute` scope restriction
- **Dashboard path traversal fix** — sanitize `/assets/*` static file serving to prevent directory escape
- **maxPayload transport-level enforcement** — cap WebSocket message size to prevent memory exhaustion
- **Docs release audit** — every stale reference, dead link, and outdated example cleaned before open-source launch
- **Copilot CLI quickstart** — streamlined onboarding for the most common use case

---

## Key Architectural Decisions

**Self-hosted only.** No cloud service, no managed offering. You run it on your machine, you control your browser. This is a security decision — browser access is too sensitive for "trust us" hosting.

**Two connection paths.** MCP for Copilot CLI and Claude Desktop. OpenClaw Skill (exec-based) for OpenClaw agents. Same relay server, two ways in.

**Flat WebSocket protocol.** The message `type` IS the action. No nested command structures, no action envelopes. `{ "type": "click", "ref": "e3" }` does what it says.

**Ref system for element targeting.** Agents get `[e0]`, `[e1]` refs from page snapshots. These map to DOM nodes server-side. More stable than selectors, more readable than CDP node IDs, survives across snapshot refreshes.

**Per-agent scopes, allowlists, rate limits, audit logging.** Every agent gets a config block defining what it can do, where it can go, how fast it can act, and every action gets logged.

---

## Security Milestones

These happened roughly in order. Each one was prompted by either an audit or a "wait, what if someone..." moment.

1. **WebSocket origin check** — reject connections from unexpected origins
2. **Auth rate limiting** — prevent token brute-force
3. **Timing-safe admin auth** — constant-time comparison to prevent timing attacks
4. **Config file permissions** — `0600` on config.yaml (contains tokens)
5. **SSRF redirect protection** — block redirect chains that escape URL allowlists
6. **Path traversal protection** — dashboard static file serving (`/assets/*`). The original screenshot path traversal was eliminated entirely by the CDP migration (base64 in memory, no file paths).
7. **Batch scope bypass fix** — enforce per-action scope checks inside batch requests
8. **wait+fn execute scope enforcement** — `fn` parameter in `wait` requires `execute` scope
9. **Hardcoded blocklist** (banking/email URLs) — added, then later reverted to user-controlled allowlists. Opinionated defaults belong in docs, not code.

---

## Stats

| | |
|---|---|
| Commits | 199 |
| PRs merged | 38 |
| Security audit rounds | 5 |
| Runtime migrations | 3 (Node → Bun → Node) |
| Browser automation libs | 2 (Puppeteer → Playwright) |
| Language experiments | 1 (Rust → removed) |

---

*This changelog was written at the point of open-source release. The commit history before v1.0.0 was squashed — this document is the record of what came before.*
