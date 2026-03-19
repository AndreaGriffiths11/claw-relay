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
command -v bun >/dev/null 2>&1 || { echo "✗ bun not found. Install: curl -fsSL https://bun.sh/install | bash"; exit 1; }

# Step 2: Check if config exists
if [ ! -f "$RELAY_DIR/config.yaml" ]; then
  echo "✗ No config.yaml found. Run: cp relay-server/config.example.yaml relay-server/config.yaml"
  exit 1
fi

# Step 3: Install dependencies if needed
if [ ! -d "$RELAY_DIR/node_modules" ]; then
  echo "⚙ Installing dependencies..."
  cd "$RELAY_DIR" && bun install
fi

# Step 3.5: Build dashboard if not built
if [ ! -d "$RELAY_DIR/dashboard/dist" ]; then
  echo "🎨 Building dashboard..."
  cd "$RELAY_DIR/dashboard" && bun install && bun run build
  echo "  ✓ Dashboard built"
fi

# Step 4: Launch Chrome with remote debugging
echo "🌐 Launching Chrome with remote debugging..."
CHROME_DATA="/tmp/claw-relay-chrome"

# Find Chrome binary (support CHROME_PATH override)
find_chrome() {
  if [ -n "$CHROME_PATH" ]; then
    if [ -x "$CHROME_PATH" ]; then echo "$CHROME_PATH"; return; fi
    echo "✗ CHROME_PATH set but not executable: $CHROME_PATH" >&2; return 1
  fi
  # macOS
  if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; return
  fi
  # Linux
  for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$cmd" >/dev/null 2>&1; then echo "$cmd"; return; fi
  done
  # WSL
  if [ -x "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" ]; then
    echo "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; return
  fi
  return 1
}

CHROME_APP="$(find_chrome)" || { echo "✗ Chrome not found. Set CHROME_PATH environment variable."; exit 1; }

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
bun src/index.ts config.yaml &
RELAY_PID=$!
sleep 1
echo "  ✓ Relay running (PID $RELAY_PID)"
echo "  Dashboard: http://localhost:9334"

# Step 7: Optional tunnel
case $TUNNEL in
  cloudflare)
    echo "☁️  Starting Cloudflare tunnel..."
    command -v cloudflared >/dev/null 2>&1 || { echo "  ✗ cloudflared not found. Run: brew install cloudflared"; exit 1; }
    echo ""
    echo "💡 If the tunnel fails or you need to restart it separately:"
    echo "   cloudflared tunnel --url http://localhost:9333"
    echo ""
    TUNNEL_LOG="/tmp/claw-relay-tunnel.log"
    cloudflared tunnel --url http://localhost:9333 --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    # Wait for tunnel URL (up to 15 seconds)
    URL=""
    for i in $(seq 1 15); do
      sleep 1
      URL=$(grep -oE 'https://[^ ]+trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
      if [ -n "$URL" ]; then break; fi
    done
    if [ -n "$URL" ]; then
      echo ""
      echo "🦞 ═══════════════════════════════════════════"
      echo "   Claw Relay is live!"
      echo "   Local:  ws://localhost:9333"
      echo "   Remote: $URL"
      echo "═══════════════════════════════════════════════"
      echo ""
    else
      echo "  ⚠ Tunnel started but URL not detected. Check: cat $TUNNEL_LOG"
    fi
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
