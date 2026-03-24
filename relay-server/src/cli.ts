#!/usr/bin/env bun
// CLI entry point for `bunx claw-relay` / `npx claw-relay`

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { spawn, execSync } from 'child_process';

// --- Parse CLI flags ---
const args = process.argv.slice(2);
let port = 9333;
let configPath = '';
let noChrome = false;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--port':
      port = parseInt(args[++i], 10);
      break;
    case '--config':
      configPath = args[++i];
      break;
    case '--no-chrome':
      noChrome = true;
      break;
    case '--help':
    case '-h':
      console.log(`
  claw-relay — Give your AI agents a real browser.

  Usage: bunx claw-relay [options]

  Options:
    --port <number>    Relay server port (default: 9333)
    --config <path>    Path to config.yaml (auto-generated if missing)
    --no-chrome        Don't launch Chrome (assumes CDP already on :9222)
    -h, --help         Show this help
`);
      process.exit(0);
  }
}

// --- Config ---
if (!configPath) {
  configPath = path.resolve('config.yaml');
}

function generateToken(): string {
  return `crly_${crypto.randomUUID().replace(/-/g, '')}`;
}

if (!fs.existsSync(configPath)) {
  const agentToken = generateToken();
  const adminToken = generateToken();

  const config = `# Claw Relay — auto-generated config
server:
  port: ${port}
  host: "0.0.0.0"

agents:
  default:
    token: "${agentToken}"
    scopes: ["read", "navigate", "interact"]
    allowlist: ["*"]
    rateLimit: 30

blocklist:
  - "*.bank.com"
  - "mail.google.com"
  - "accounts.google.com"

audit:
  logFile: "./audit.jsonl"
  logToStdout: false

engine:
  timeout: 30000

dashboard:
  port: ${port + 1}
  adminToken: "${adminToken}"
`;
  fs.writeFileSync(configPath, config, 'utf-8');
  console.log(`📝 Generated config at ${configPath}`);

  // Store tokens for banner
  (globalThis as any).__generatedAgentToken = agentToken;
  (globalThis as any).__generatedAdminToken = adminToken;
}

// --- Chrome launch ---
function findChrome(): string | null {
  const paths = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean) as string[];

  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }

  // Try which
  for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (result) return result;
    } catch {}
  }

  return null;
}

let chromePid: number | undefined;

async function launchChrome(): Promise<void> {
  // Check if CDP is already running
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version');
    if (res.ok) {
      console.log('🌐 Chrome already running with CDP on port 9222');
      return;
    }
  } catch {}

  const chromePath = findChrome();
  if (!chromePath) {
    console.error('✗ Chrome not found. Install Chrome or set CHROME_PATH.');
    process.exit(1);
  }

  console.log('🌐 Launching Chrome...');
  const child = spawn(chromePath, [
    '--remote-debugging-port=9222',
    '--user-data-dir=/tmp/claw-relay-chrome',
    '--window-size=1920,1080',
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' });

  child.unref();
  chromePid = child.pid;

  // Wait for CDP
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        console.log(`   ✓ Chrome ready (PID ${chromePid})`);
        return;
      }
    } catch {}
  }
  console.error('✗ Chrome failed to start with CDP. Is another instance running?');
  process.exit(1);
}

// --- Main ---
async function main() {
  if (!noChrome) {
    await launchChrome();
  }

  // Import and start server (it reads config from argv)
  process.argv[2] = configPath;

  // Read config for banner info
  const YAML = await import('yaml');
  const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
  const serverPort = config.server?.port || port;
  const dashPort = config.dashboard?.port || serverPort + 1;

  // Start the server
  await import('./index');

  // Banner
  const agentToken = (globalThis as any).__generatedAgentToken;
  const adminToken = (globalThis as any).__generatedAdminToken;

  console.log('');
  console.log('🦞 ═══════════════════════════════════════════');
  console.log('   Claw Relay is live!');
  console.log('');
  console.log(`   WebSocket:  ws://localhost:${serverPort}`);
  console.log(`   Dashboard:  http://localhost:${dashPort}`);
  if (agentToken) {
    console.log('');
    console.log(`   Agent token:  ${agentToken}`);
    console.log(`   Admin token:  ${adminToken}`);
    console.log('   (saved in config.yaml — change before exposing)');
  }
  console.log('═══════════════════════════════════════════════');
  console.log('');
}

// Cleanup
process.on('SIGINT', () => {
  if (chromePid) try { process.kill(chromePid); } catch {}
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (chromePid) try { process.kill(chromePid); } catch {}
  process.exit(0);
});

main().catch(e => { console.error(e); process.exit(1); });
