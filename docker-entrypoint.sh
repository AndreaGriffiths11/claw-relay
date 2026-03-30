#!/bin/bash
set -e

CONFIG_DIR="/app/data"
CONFIG_FILE="$CONFIG_DIR/config.yaml"

mkdir -p "$CONFIG_DIR"

# Always regenerate config (env vars are the source of truth)
if true; then
  AGENT_TOKEN="${AGENT_TOKEN:-crly_$(openssl rand -hex 24)}"
  ADMIN_TOKEN="${ADMIN_TOKEN:-crly_$(openssl rand -hex 24)}"
  PORT="${PORT:-9333}"
  DASHBOARD_PORT="${DASHBOARD_PORT:-9334}"

  cat > "$CONFIG_FILE" <<EOF
server:
  port: ${PORT}
  host: "0.0.0.0"

agents:
  default:
    token: "${AGENT_TOKEN}"
    scopes: ["read", "interact", "navigate", "execute"]
    allowlist: ["*"]
    rateLimit: 60

blocklist:
  - "*.bank.com"
  - "mail.google.com"
  - "accounts.google.com"

audit:
  logFile: "${CONFIG_DIR}/audit.jsonl"
  logToStdout: true

engine:
  timeout: 30000

dashboard:
  port: ${DASHBOARD_PORT}
  adminToken: "${ADMIN_TOKEN}"
EOF

  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  🦞 Claw Relay — Config Generated"
  echo "═══════════════════════════════════════════════"
  echo "  Agent Token:  ${AGENT_TOKEN}"
  echo "  Admin Token:  ${ADMIN_TOKEN}"
  echo "  Relay Port:   ${PORT}"
  echo "  Dashboard:    ${DASHBOARD_PORT}"
  echo ""
  echo "  Set AGENT_TOKEN and ADMIN_TOKEN env vars"
  echo "  to use your own tokens on next deploy."
  echo "═══════════════════════════════════════════════"
  echo ""
fi

# Launch Chrome headless
chromium \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  &

# Wait for Chrome to be ready
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Start relay
exec node relay-server/dist/cli.js --config "$CONFIG_FILE" --no-chrome --port "${PORT:-9333}"
