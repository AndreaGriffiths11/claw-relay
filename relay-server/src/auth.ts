import * as fs from 'fs';
import * as crypto from 'node:crypto';
import * as YAML from 'yaml';

export interface AgentConfig {
  token: string;
  scopes: string[];
  allowlist: string[];
  rateLimit: number;
}

export interface Config {
  server: { port: number; host: string };
  agents: Record<string, AgentConfig>;
  blocklist: string[];
  audit: { logFile: string; logToStdout: boolean };
  engine: { binary: string; timeout: number };
  dashboard: { port: number; adminToken: string };
}

// SHA-256 both sides before comparing so timingSafeEqual can't leak
// token length via timing differences on mismatched buffer sizes
export function authenticate(config: Config, token: string, agentId: string): AgentConfig | null {
  const agent = config.agents[agentId];
  if (!agent) return null;

  const storedHash = crypto.createHash('sha256').update(agent.token).digest();
  const providedHash = crypto.createHash('sha256').update(token).digest();

  if (!crypto.timingSafeEqual(storedHash, providedHash)) return null;
  return agent;
}

export function loadConfig(configPath: string): Config {
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw);

  return {
    server: parsed.server || { port: 9333, host: '127.0.0.1' },
    agents: parsed.agents || {},
    blocklist: parsed.blocklist || [],
    audit: parsed.audit || { logFile: './audit.jsonl', logToStdout: true },
    engine: parsed.engine || { binary: 'agent-browser', timeout: 30_000 },
    dashboard: {
      port: parsed.dashboard?.port || 9334,
      adminToken: parsed.dashboard?.adminToken || '',
    },
  };
}
