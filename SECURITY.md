# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Claw Relay, **please report it responsibly**.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **andreagriffiths11@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: As soon as possible, depending on severity

## Scope

This policy covers:
- The relay server (`relay-server/`)
- The Chrome extension (`extension/`)
- The MCP server (`mcp/`)
- The OpenClaw skill (`skills/`)

## Security Design

Claw Relay is designed with defense-in-depth:

- **Per-agent authentication** with unique tokens
- **Scoped permissions** (read, interact, navigate, execute)
- **Per-agent URL allowlists** and global blocklists
- **Rate limiting** per agent
- **SSRF protection** against redirect-based attacks
- **Audit logging** of every action
- **Config file permissions** (0600) on auto-generated configs

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |
| < 1.0   | ❌        |
