# Using Claw Relay Responsibly

Claw Relay gives an AI agent access to your real browser. Your cookies, your sessions, your logins. That's the point — and it's also why you should be deliberate about how you use it.

A browser-connected agent can see and do anything the signed-in user can. Private repos, admin panels, billing pages, internal tools. If the browser can reach it, so can the agent.

Use Claw Relay when you need a real browser with guardrails around it. Don't treat it as a default replacement for APIs or standard automation.

## When Claw Relay is the right tool

Claw Relay sits between your agent and Chrome. It enforces auth, permissions, rate limits, and site restrictions before anything touches the browser.

Use it when:

- The task depends on the live browser UI, not an API
- The user needs to stay signed in with a real session
- You want to control where the agent can go and what it can do
- You need an audit trail of every action
- You're experimenting with agent workflows but want explicit guardrails

It's especially useful when the workflow depends on page state or a browser session that can't be reproduced through an API.

## When something else is better

If you don't need a real signed-in browser, you probably don't need Claw Relay.

| Use case | Better tool | Why |
|---|---|---|
| Repeatable GitHub automation | GitHub API / Apps / Actions | Audited, scoped, no browser needed |
| Deterministic browser scripting | Playwright / Puppeteer / Selenium | Full automation control, no relay overhead |
| Large-scale business process automation | RPA or enterprise workflow tools | Built for cross-system orchestration at scale |

## How Claw Relay compares to direct browser-control tools

Some tools give an AI agent direct browser control out of the box. That's great for prototyping. Claw Relay solves a different problem.

| Direct browser-control tools | Claw Relay |
|---|---|
| Strong browser capability for the model | Trust layer between agent and browser |
| Optimized for task completion | Optimized for control and auditability |
| Minimal setup friction | Per-agent tokens, scopes, allowlists, audit logs |

Use direct browser tools when speed matters most. Use Claw Relay when the browser is signed in to real services and you care about control, isolation, and visibility.

## Using Claw Relay with GitHub

Claw Relay can work with GitHub, but prefer official integrations first. GitHub API, Apps, and Actions cover most automation needs cleanly.

Use Claw Relay with GitHub only when the task genuinely depends on the live web UI.

**Lower-risk examples:**

- Navigating issues and PRs with user approval
- Reading page context to help draft content
- Small, supervised browser tasks

**Higher-risk examples:**

- Mass commenting, starring, following, or issue creation
- Scraping through the web UI at scale
- Unattended operation on a logged-in account
- Bypassing APIs, permissions, or rate limits

The line is behavior, not tooling. Human-supervised, limited workflows are different from high-volume, unattended automation.

## Guardrails

If you're running Claw Relay against real services, start with these.

### Use the minimum scopes

Grant only what the workflow needs.

```yaml
agents:
  my-agent:
    scopes: ["read", "navigate"]  # start here
    # add "interact" only when the task requires clicks/typing
    # avoid "execute" unless you fully trust the workflow
```

### Restrict where the agent can go

```yaml
agents:
  my-agent:
    allowlist: ["github.com"]  # only what's needed

blocklist:
  - "*.bank.com"  # always blocked for all agents
  - "admin.*"
```

Be aggressive with allowlists. Avoid broad wildcard access unless the environment is disposable.

### Keep a human in the loop

Don't let the agent perform high-impact actions without review. This matters most for:

- Posting content or submitting forms
- Editing settings or deleting data
- Working in admin, billing, or account management screens

### Start with low rate limits

```yaml
agents:
  my-agent:
    rateLimit: 15  # conservative, increase as you build trust
```

Low limits make mistakes easier to catch and harder to scale.

### Treat screenshots and snapshots as sensitive

Browser captures may contain private repo names, tokens visible in page content, internal dashboards, or personal data. Handle them like sensitive application data.

### Use a separate browser profile

Claw Relay already uses a dedicated profile at `~/.claw-relay/chrome-data/`. Don't share it with your normal browsing. This avoids exposing unrelated sessions, cookies, and personal context.

### Monitor the audit log

The dashboard shows every action in real time. Review it periodically, especially when testing new workflows. If something looks wrong, use the kill switch first and investigate after.
