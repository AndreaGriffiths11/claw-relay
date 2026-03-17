# Remote Access (Tunneling)

The relay runs on your machine. Tunnels make it reachable by remote agents.

## Option A: Cloudflare Quick Tunnel (easiest)

No account needed.

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:9333
```

You'll get a URL like `https://random-words.trycloudflare.com`. Connect via `wss://random-words.trycloudflare.com/`.

> Quick tunnels are temporary — the URL changes on restart. For persistent URLs, set up a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps).

## Option B: Tailscale

If both machines are on the same tailnet, connect directly: `ws://<tailscale-ip>:9333`.

## Option C: ngrok

```bash
ngrok http 9333
```

Connect via the provided `wss://xxxx.ngrok-free.app`.

## Security

The tunnel exposes the relay to the internet, but every connection still requires a valid agent token. Without one, the relay rejects the connection. Allowlists, blocklist, scopes, and rate limiting all still apply — the tunnel is just transport.
