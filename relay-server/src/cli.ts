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

  // Use a persistent dedicated profile — not the user's main Chrome profile
  // (can't share with an already-running Chrome) but logins persist between runs
  const platform = process.platform;
  const profileDir = platform === 'darwin'
    ? `${process.env.HOME}/.claw-relay/chrome-data`
    : platform === 'win32'
      ? `${process.env.LOCALAPPDATA}\\.claw-relay\\chrome-data`
      : `${process.env.HOME}/.claw-relay/chrome-data`;

  // Check if Chrome is already running
  const chromeRunning = (() => {
    try {
      execSync(
        platform === 'darwin' ? 'pgrep -f "claw-relay/chrome-data"' : 'pgrep -f "claw-relay/chrome-data"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return true;
    } catch { return false; }
  })();

  if (chromeRunning) {
    // Kill only the Claw Relay Chrome, not the user's main Chrome
    console.log('🌐 Restarting Claw Relay Chrome...');
    try { execSync('pkill -f "claw-relay/chrome-data"', { stdio: 'ignore' }); } catch {}
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log('🌐 Launching Chrome...');
  }

  const child = spawn(chromePath, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });

  // Log Chrome stderr for debugging
  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('DevTools listening')) {
        console.log(`   Chrome: ${msg.slice(0, 200)}`);
      }
    });
  }

  child.unref();
  chromePid = child.pid;

  // Bring to front on macOS
  if (platform === 'darwin') {
    setTimeout(() => {
      try { execSync('osascript -e \'activate app "Google Chrome"\'', { stdio: 'ignore' }); } catch {}
    }, 2000);
  }

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
  console.error('✗ Chrome failed to start with CDP.');
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
