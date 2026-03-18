# Claw Relay — Project Viability Review (v2)

## What It Is

Claw Relay is a WebSocket relay server that acts as a **trust layer between AI agents and a real Chrome browser**. Agents authenticate via token, and the relay enforces permission scopes, URL allowlists/blocklists, rate limits, and audit logging before forwarding actions to `agent-browser` (Chrome via CDP). It includes an admin dashboard and optional Chrome extension.

**904 lines of TypeScript**, 2 runtime dependencies (`ws`, `yaml`), MIT licensed.

---

## CODE QUALITY ASSESSMENT

### Strengths

**Architecture (Strong):** Clean separation of concerns across 9 small modules — auth, protocol, permissions, allowlist, rate-limiter, audit-logger, engine, state, dashboard. Each file is under 55 lines except the dashboard (486 lines, mostly inline HTML). The request pipeline in `index.ts` is easy to follow: parse → auth → permission → rate limit → allowlist → execute → audit.

**Minimal dependencies (Strong):** Only `ws` and `yaml` at runtime. Everything else uses Node built-ins. This dramatically reduces supply chain risk — critical for a security-focused tool.

**Atomic config writes (Good):** `writeConfigAtomic()` in `dashboard.ts:40-53` writes to a temp file then renames, preventing config corruption on crash.

**WeakMap for client state (Good):** Automatic GC of disconnected client state without manual cleanup.

**TypeScript strict mode (Good):** `tsconfig.json` has `strict: true`, catching type errors at compile time.

### Security Issues

**1. Full token exposed via API (Critical)**
`dashboard.ts:116` — the `/api/config` endpoint sends `_fullToken: agent.token` alongside the redacted version. Any authenticated dashboard user can extract every agent's plaintext token. The redaction is purely cosmetic. This completely undermines the token-per-agent security model, since compromising the admin dashboard compromises all agents.

**2. XSS in dashboard (High)**
`dashboard.ts:397-404` — agent IDs, allowlist values, action data, and targets are injected into the DOM via `innerHTML` with zero escaping. A malicious agent ID like `<img onerror=alert(1) src=x>` would execute JavaScript in the admin's browser. Since the dashboard is the security control plane, XSS here could be used to create new agents, exfiltrate tokens (see issue #1), or delete audit logs — silently.

**3. Token in URL query parameter (High)**
`dashboard.ts:17` and the frontend JS (`api()` function at line 358-363) pass the admin token as `?token=...` in the URL. This leaks credentials into:
- Browser history (persists after logout)
- Server access logs
- HTTP Referer headers if the page loads external resources (it loads Google Fonts — `dashboard.ts:229-230`)
- Cloudflare tunnel logs (if tunneled)

The Google Fonts import is particularly concerning: every dashboard page load sends a request to `fonts.googleapis.com` with the admin token visible in the referer.

**4. Token comparison is not timing-safe (Medium)**
`auth.ts:22` uses `===` for token comparison. Over a network, this enables timing side-channel attacks to brute-force tokens character by character. Should use `crypto.timingSafeEqual()`.

**5. No body size limit on POST/PUT (Medium)**
`dashboard.ts:56-61` accumulates the full request body in memory with no size cap. An attacker with a valid admin token (or one leaked via issue #3) could exhaust server memory with a single large POST.

**6. CORS wildcard on all API responses (Medium)**
`dashboard.ts:65-66` sets `Access-Control-Allow-Origin: *` on every API response. Combined with the token-in-URL pattern, any website the admin visits could make cross-origin requests to the dashboard API if the token is known or guessable.

**7. No input validation on agent CRUD API (Medium)**
`dashboard.ts:160-168` — `POST /api/agents` accepts any shape for `scopes`, `allowlist`, `rateLimit` without type checking. Passing `scopes: "not-an-array"` or `rateLimit: -1` would corrupt the config file and potentially crash the relay.

**8. `evaluate` action allows arbitrary JS execution (Design Risk)**
`engine.ts:24` passes user-supplied JavaScript directly to `agent-browser eval`. While gated by the `execute` scope, there's no sandboxing, CSP enforcement, or JS content filtering. An agent with `execute` scope has equivalent access to `chrome.debugger` — it can exfiltrate cookies, localStorage, passwords from autofill, etc.

### Correctness Issues

**9. Port mismatch: test.ts connects to wrong port**
`test.ts:3` connects to `ws://127.0.0.1:9222` but the relay server defaults to port `9333` (per `config.example.yaml:2`). Port 9222 is Chrome's CDP port. The test client would connect to Chrome directly, bypassing the relay entirely — defeating the purpose of a test.

**10. Protocol docs incorrect: `close` scope mismatch**
`docs/protocol.md:27` says `close` requires "any" scope, but `permissions.ts:11` maps `close` to `navigate`. An agent with only `read` scope cannot close the browser, contradicting the docs.

**11. Chrome extension is non-functional**
`background.js:6` and `popup.js:14` poll `GET /health` on the relay server, but no `/health` endpoint exists in the server code. The extension will permanently show "Offline" regardless of server state. This is dead code shipped as a feature.

**12. State module doesn't handle concurrent agents with same ID**
`state.ts:12` — `agentConnected()` overwrites any existing state for the same `agentId`. If two WebSocket connections authenticate as the same agent, the first connection's state is silently lost, and `agentDisconnected()` for either connection deletes state for both.

**13. Dashboard admin token fallback is insecure**
`auth.ts:37` — if `dashboard.adminToken` is not set in config, it falls back to the first agent's token. This means the first agent's token doubles as the admin credential, violating least-privilege. The example config has `adminToken: "change-me"` which many users will leave as-is.

### Performance & Operational Issues

**14. `getCurrentUrl()` spawns a process on every action (Performance)**
`index.ts:105` calls `engine.getCurrentUrl()` before every non-navigate, non-close action. This spawns a child process (`execFile`) each time, adding 50-200ms latency per action. For a `snapshot` → `click` → `snapshot` sequence, that's 3 extra process spawns. Should cache the current URL and update it on `navigate` results.

**15. Rate limiter never cleans up (Memory Leak)**
`rate-limiter.ts` — the `tokens` Map grows unboundedly as agent IDs accumulate. In a long-running server with many agents connecting/disconnecting, this is a slow memory leak.

**16. Audit log read is synchronous and unbounded**
`dashboard.ts:31-34` calls `fs.readFileSync()` on the audit log, then parses all lines, then takes the last 100. For a large audit file (millions of lines after weeks of use), this blocks the event loop and may OOM.

**17. start.sh is macOS-only**
`start.sh:40` hardcodes the Chrome path as `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. This script won't work on Linux or Windows/WSL. No platform detection is attempted.

**18. No graceful WebSocket shutdown**
When the relay server shuts down (SIGINT/SIGTERM), there's no `wss.close()` call. Connected agents won't receive a clean close frame — they'll get a TCP reset and have to infer the server went down.

### Code Quality Issues

**19. No test suite**
Only a manual test client (`test.ts`) that connects to the wrong port. No unit tests, no integration tests, no CI pipeline. For a security-critical relay, every permission check, allowlist rule, and rate limit boundary should have test coverage.

**20. No TLS/WSS support**
The WebSocket server runs plain `ws://`. Tokens are transmitted in cleartext. The docs suggest Cloudflare tunnels for encryption, but local network use (the primary use case) has no encryption path. Should support `wss://` natively or document reverse proxy setup as mandatory.

**21. Dashboard HTML is a 260-line string literal**
`dashboard.ts:222-486` embeds the entire HTML/CSS/JS dashboard as a template string. While this avoids a build step, it makes the dashboard unmaintainable — no syntax highlighting, no linting, no component reuse. Any security fix (like escaping HTML) requires editing inside a string literal.

---

## BUSINESS VIABILITY ASSESSMENT

### Market Context

The AI agent ecosystem is growing rapidly (2025-2026). Browser automation for agents is an active space with players like:
- **Browserbase, Browser Use** — cloud-hosted browser environments
- **Playwright MCP** — direct browser control from agent frameworks
- **agent-browser** — the underlying CDP tool Claw Relay wraps

### Value Proposition

Claw Relay's unique angle is **security and trust**: it doesn't provide browser automation itself, it governs who can do what. The pitch is: "You wouldn't give an AI agent raw access to your browser — Claw Relay adds auth, permissions, allowlists, rate limits, and audit."

This is a **real and underserved need**. Most browser automation tools give agents full access with no guardrails.

### Viability Strengths

1. **Clear problem-solution fit** — as agents get more autonomous, enterprises need access control layers. This fills a real gap.
2. **Lightweight and composable** — 2 dependencies, runs alongside existing tools, doesn't lock you in.
3. **Good developer experience** — one-command `start.sh`, YAML config, WebSocket protocol, comprehensive docs.
4. **Dashboard for non-developers** — the admin UI makes it accessible to ops/security teams.
5. **Extensible architecture** — could wrap other browser engines beyond `agent-browser`, or add new action types.
6. **Strong documentation** — protocol spec, setup guide, troubleshooting guide, and architecture docs exceed what most v0.1 projects ship with.

### Viability Risks

1. **Dependency on `agent-browser`** — The entire engine layer shells out to a single CLI tool. If `agent-browser` changes its API, breaks, or is abandoned, Claw Relay breaks. There's no abstraction layer for alternative engines (Playwright, Puppeteer, etc.).

2. **Single-user, single-browser** — The current architecture assumes one Chrome instance. There's no session isolation between agents — two agents with `navigate` scope interfere with each other (one navigates away from the other's page). Multi-tenancy would require significant rework (per-agent browser contexts or separate Chrome instances).

3. **No persistent state** — All state is in-memory (connections, rate limiter buckets). A server restart loses everything. The audit log survives (JSONL file), but there's no session continuity, no action replay, no analytics.

4. **Competitive moat is thin** — The security layer is ~400 lines of logic. A larger player (Browserbase, etc.) could add equivalent permission/audit features as a built-in option. The value is in the concept, not proprietary technology.

5. **Revenue model unclear** — MIT licensed, no SaaS layer, no pricing. As an open-source project it could gain adoption, but monetization would require either an enterprise edition, hosted offering, or consulting.

6. **Security credibility gap** — A tool marketed as a "trust layer" has plaintext token leaks, XSS in the control plane, and no tests. If discovered publicly, this would damage trust more than having no security claims at all. The gap between the marketing ("trust layer") and reality (multiple security vulnerabilities) is the project's biggest reputational risk.

7. **Platform lock-in to macOS** — The start script only works on macOS. Linux and Windows users (the majority of server environments) cannot use the one-command setup, which is a key UX selling point.

---

## SUMMARY SCORECARD

| Dimension | Score | Notes |
|---|---|---|
| **Code Architecture** | 7/10 | Clean separation, but dashboard is a monolith string; state management has concurrency bugs |
| **Code Quality** | 4/10 | No tests, wrong port in test file, dead extension code, no CI |
| **Security Posture** | 3/10 | Critical: token leak via API, XSS in control plane, token in URL with external referer leak to Google Fonts |
| **Documentation** | 7/10 | Thorough but contains inaccuracies (close scope, extension functionality) |
| **Market Fit** | 7/10 | Real problem, growing market, clear positioning |
| **Competitive Position** | 5/10 | Easy to replicate, no moat beyond first-mover |
| **Production Readiness** | 2/10 | Cannot be deployed in any security-sensitive context in current state |
| **Business Viability** | 5/10 | Strong concept, but credibility gap between claims and implementation is the #1 risk |

### Bottom Line

**Claw Relay solves a real problem with clean architecture, but its security implementation contradicts its security mission.** A "trust layer" that leaks all agent tokens via its own API, is vulnerable to XSS in its control plane, and sends admin credentials to Google via referer headers would be a liability, not an asset, in any production environment.

The good news: the codebase is small (904 lines) and well-structured enough that all issues are fixable. The architecture doesn't need to change — the implementation details do.

**Priority 1 — Security (must fix before any public demo):**
1. Remove `_fullToken` from `/api/config` responses entirely
2. Escape all HTML in dashboard rendering (add a global `escapeHtml()` utility)
3. Remove Google Fonts external load; bundle or use system fonts
4. Switch to `Authorization: Bearer` header only; remove `?token=` query param support
5. Add `crypto.timingSafeEqual()` for all token comparisons
6. Restrict CORS to dashboard origin instead of `*`
7. Add request body size limits (e.g., 1MB cap)
8. Validate types on all API inputs (scopes must be array, rateLimit must be positive integer, etc.)

**Priority 2 — Correctness (must fix before v0.2):**
1. Fix test.ts to connect to port 9333
2. Fix protocol.md to document `close` requires `navigate` scope
3. Implement `/health` endpoint or remove extension from repo
4. Handle duplicate agent ID connections in state.ts
5. Don't fall back admin token to first agent's token
6. Add platform detection to start.sh (Linux Chrome paths)

**Priority 3 — Performance & Operations:**
1. Cache current URL instead of spawning a process per action
2. Add periodic cleanup to rate limiter Map
3. Read audit log with streaming/tail instead of readFileSync
4. Add graceful WebSocket shutdown on SIGINT/SIGTERM

**Priority 4 — Business Viability:**
1. Add unit tests for permissions, allowlist, rate limiter, auth (these are small pure functions — easy wins)
2. Add CI pipeline (GitHub Actions) with TypeScript compile + tests
3. Multi-agent session isolation (browser contexts per agent)
4. Engine abstraction layer (pluggable backends)
5. Define monetization strategy
