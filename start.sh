#!/bin/bash
# Claw Relay — Start Everything
# Usage: ./start.sh [--tunnel cloudflare|tailscale|none] [--port 9333]

set -e
cd "$(dirname "$0")"

TUNNEL="cloudflare"
PORT="9333"
EXTRA_ARGS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tunnel) TUNNEL="$2"; shift 2;;
    --no-tunnel) TUNNEL="none"; shift;;
    --port) PORT="$2"; EXTRA_ARGS="$EXTRA_ARGS --port $2"; shift 2;;
    *) shift;;
  esac
done

# Clean up stale processes from previous runs
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "🧹 Killing stale process on port $PORT..."
  lsof -ti:"$PORT" | xargs kill 2>/dev/null
  sleep 1
fi
DASH_PORT=$((PORT + 1))
if lsof -ti:"$DASH_PORT" >/dev/null 2>&1; then
  lsof -ti:"$DASH_PORT" | xargs kill 2>/dev/null
  sleep 1
fi

echo "🦞 Claw Relay Starting..."
echo ""

# Check dependencies
MISSING=""
if ! command -v node >/dev/null 2>&1; then MISSING="$MISSING node"; fi
if [ "$TUNNEL" = "cloudflare" ] && ! command -v cloudflared >/dev/null 2>&1; then MISSING="$MISSING cloudflared"; fi

if [ -n "$MISSING" ]; then
  echo "✗ Missing:$MISSING"
  echo ""
  command -v node >/dev/null 2>&1 || echo "  Install Node: https://nodejs.org
  command -v cloudflared >/dev/null 2>&1 || echo "  Install cloudflared: brew install cloudflared"
  echo ""
  exit 1
fi

# Install deps if needed
if [ ! -d "relay-server/node_modules" ]; then
  echo "⚙  Installing dependencies..."
  cd relay-server && npm install && cd ..
fi

# Build dashboard if needed
if [ ! -d "relay-server/dashboard/dist" ]; then
  echo "🎨 Building dashboard..."
  cd relay-server/dashboard && npm install && npm run build && cd ../..
fi

# Start relay (handles Chrome + server + auto-config)
cd relay-server
CLAW_RELAY_NO_BANNER=1 npx tsx src/cli.ts $EXTRA_ARGS &
RELAY_PID=$!
cd ..

# Wait for relay to be ready
for i in $(seq 1 15); do
  sleep 1
  if curl -s "http://localhost:$((PORT + 1))/health" >/dev/null 2>&1; then break; fi
done

# Tunnel
case $TUNNEL in
  cloudflare)
    echo "☁️  Starting Cloudflare tunnel..."
    TUNNEL_LOG="/tmp/claw-relay-tunnel.log"
    cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    URL=""
    for i in $(seq 1 15); do
      sleep 1
      URL=$(grep -oE 'https://[^ ]+trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
      if [ -n "$URL" ]; then break; fi
    done
    if [ -n "$URL" ]; then
      WS_URL=$(echo "$URL" | sed 's|https://|wss://|')
      echo ""
      echo ""
      echo "🦞 ═══════════════════════════════════════════"
      echo "   Claw Relay is live!"
      echo ""
      echo "   Local:      ws://localhost:$PORT"
      echo "   Remote:     $WS_URL"
      echo "   Dashboard:  http://localhost:$((PORT + 1))"
      echo ""
      echo "   Connect your agent:"
      echo "   RELAY_URL=$WS_URL"
      echo "═══════════════════════════════════════════════"
      echo ""
    else
      echo "  ⚠ Tunnel started but URL not detected. Check: cat $TUNNEL_LOG"
    fi
    ;;
  tailscale)
    echo "🔒 Tailscale serve on port $PORT..."
    tailscale serve --bg "$PORT"
    ;;
  none)
    echo ""
    echo ""
    echo "🦞 ═══════════════════════════════════════════"
    echo "   Claw Relay is live!"
    echo ""
    echo "   Local:      ws://localhost:$PORT"
    echo "   Dashboard:  http://localhost:$((PORT + 1))"
    echo "═══════════════════════════════════════════════"
    echo ""
    ;;
esac

# Cleanup
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  [ -n "$RELAY_PID" ] && kill $RELAY_PID 2>/dev/null
  [ -n "$TUNNEL_PID" ] && kill $TUNNEL_PID 2>/dev/null
  echo "   ✓ Done"
  exit 0
}
trap cleanup SIGINT SIGTERM

wait
