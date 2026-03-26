#!/bin/bash
cd "$(dirname "$0")/relay-server"
TUNNEL=none npx tsx src/cli.ts --tunnel none &
sleep 2
cloudflared tunnel run claw-relay
