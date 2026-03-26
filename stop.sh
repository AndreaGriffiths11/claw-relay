#!/bin/bash
echo "🦞 Stopping Claw Relay..."
pkill -f "node dist/index.js config.yaml" 2>/dev/null && echo "  ✓ Relay stopped" || echo "  - Relay not running"
pkill -f "cloudflared tunnel" 2>/dev/null && echo "  ✓ Tunnel stopped" || echo "  - Tunnel not running"
echo "  ℹ Chrome left running (close manually if needed)"
echo "Done."
