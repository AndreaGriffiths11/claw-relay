#!/bin/bash
# Claw Relay — Start Everything
# Usage: ./start.sh [--tunnel cloudflare|tailscale|none]

set -e

RELAY_DIR="$(cd "$(dirname "$0")/relay-server" && pwd)"

# Parse args properly
TUNNEL="cloudflare"
while [[ $# -gt 0 ]]; do
  case $1 in
    --tunnel) TUNNEL="$2"; shift 2;;
    --no-tunnel) TUNNEL="none"; shift;;
    *) shift;;
  esac
done

echo "🦞 Claw Relay Starting..."
echo ""

# Step 1: Check dependencies
command -v agent-browser >/dev/null 2>&1 || { echo "✗ agent-browser not found. Run: npm install -g agent-browser"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ node not found"; exit 1; }

# Step 2: Check if config exists
if [ ! -f "$RELAY_DIR/config.yaml" ]; then
  echo "✗ No config.yaml found. Run: cp relay-server/config.example.yaml relay-server/config.yaml"
  exit 1
fi

# Step 3: Check if dist exists, build if not
if [ ! -f "$RELAY_DIR/dist/index.js" ]; then
  echo "⚙ Building relay server..."
  cd "$RELAY_DIR" && npx tsc
fi

# Step 4: Launch Chrome with remote debugging
echo "🌐 Launching Chrome with remote debugging..."
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_DATA="/tmp/claw-relay-chrome"

# Check if Chrome is already running with debugging
if curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
  echo "  ✓ Chrome already running with debugging on port 9222"
else
  # Launch Chrome in background
  "$CHROME_APP" --remote-debugging-port=9222 --user-data-dir="$CHROME_DATA" &
  CHROME_PID=$!
  sleep 3
  if curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
    echo "  ✓ Chrome launched (PID $CHROME_PID)"
  else
    echo "  ✗ Chrome failed to start with debugging. Is another instance running? Quit Chrome (Cmd+Q) and try again."
    exit 1
  fi
fi

# Step 5: Connect agent-browser
echo "🔗 Connecting agent-browser to Chrome..."
agent-browser connect http://localhost:9222
echo "  ✓ Connected"

# Step 6: Start relay server
echo "📡 Starting relay server..."
cd "$RELAY_DIR"
node dist/index.js config.yaml &
RELAY_PID=$!
sleep 1
echo "  ✓ Relay running (PID $RELAY_PID)"

# Step 7: Optional tunnel
case $TUNNEL in
  cloudflare)
    echo "☁️  Starting Cloudflare tunnel..."
    command -v cloudflared >/dev/null 2>&1 || { echo "  ✗ cloudflared not found. Run: brew install cloudflared"; exit 1; }
    cloudflared tunnel --url http://localhost:9333 2>&1 | while IFS= read -r line; do
      if echo "$line" | grep -q "trycloudflare.com"; then
        URL=$(echo "$line" | grep -oE 'https://[^ ]+trycloudflare.com')
        if [ -n "$URL" ]; then
          echo ""
          echo "🦞 ═══════════════════════════════════════════"
          echo "   Claw Relay is live!"
          echo "   Local:  ws://localhost:9333"
          echo "   Remote: $URL"
          echo "═══════════════════════════════════════════════"
          echo ""
        fi
      fi
    done
    ;;
  tailscale)
    echo "🔒 Starting Tailscale serve..."
    tailscale serve --bg 9333
    echo "  ✓ Available on your tailnet"
    echo ""
    echo "🦞 Claw Relay is live!"
    echo "   Local: ws://localhost:9333"
    echo "   Tailnet: https://$(tailscale status --self --json | grep -o '"DNSName":"[^"]*' | cut -d'"' -f4)"
    ;;
  none)
    echo ""
    echo "🦞 Claw Relay is live!"
    echo "   Local: ws://localhost:9333"
    echo "   No tunnel (local only)"
    ;;
esac

# Cleanup on exit
cleanup() {
  echo ""
  echo "🦞 Shutting down..."
  [ -n "$RELAY_PID" ] && kill $RELAY_PID 2>/dev/null && echo "  ✓ Relay stopped"
  [ -n "$CHROME_PID" ] && kill $CHROME_PID 2>/dev/null && echo "  ✓ Chrome stopped"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Keep running
wait
