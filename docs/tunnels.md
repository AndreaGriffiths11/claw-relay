# Remote Access (Tunneling)

The relay runs on your machine. If your agent is on the **same machine**, just use `ws://localhost:9333` — no tunnel needed.

Tunnels make the relay reachable by **remote** agents.

## Using start.sh

`start.sh` has built-in tunnel support:

```bash
./start.sh                       # Cloudflare quick tunnel (default)
./start.sh --tunnel none         # local only, no tunnel
./start.sh --tunnel tailscale    # Tailscale serve
```

## Option A: Cloudflare Quick Tunnel (easiest, temporary)

No account needed. Good for testing.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:9333
```

You'll get a URL like `https://random-words.trycloudflare.com`. Connect via `wss://random-words.trycloudflare.com/`.

> Quick tunnels are temporary — the URL changes on restart.

## Option B: Cloudflare Named Tunnel (permanent URL — recommended)

One-time setup. URL never changes.

```bash
# 1. Authenticate with Cloudflare
cloudflared tunnel login

# 2. Create the tunnel
cloudflared tunnel create claw-relay

# 3. Route a subdomain to it
cloudflared tunnel route dns claw-relay relay.yourdomain.com

# 4. Run it
cloudflared tunnel run --url http://localhost:9333 claw-relay
```

Your relay is now permanently at `wss://relay.yourdomain.com/`. Use this URL in your MCP config and agent connections — it never changes across restarts.

Requires a domain on Cloudflare (free plan works).

## Option C: Tailscale

If both machines are on the same tailnet:

- **Direct access** (no `tailscale serve`): `ws://<tailscale-ip>:9333`
- **Via `tailscale serve`** (HTTPS proxy): `wss://<tailscale-hostname>/`

`start.sh --tunnel tailscale` uses `tailscale serve` which proxies via HTTPS on port 443.

## Option D: ngrok (manual)

ngrok is not integrated into `start.sh` — run it alongside the relay:

```bash
ngrok http 9333
```

Connect via the provided `wss://xxxx.ngrok-free.app/`.

## Security

The tunnel exposes the relay to the internet, but every connection still requires a valid agent token. Without one, the relay rejects the connection. Allowlists, blocklist, scopes, and rate limiting all still apply — the tunnel is just transport.
