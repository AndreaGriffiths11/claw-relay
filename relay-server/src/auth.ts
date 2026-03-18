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

export function authenticate(config: Config, token: string, agentId: string): AgentConfig | null {
  const agent = config.agents[agentId];
  if (!agent) return null;
  const a = crypto.createHash('sha256').update(agent.token).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  if (!crypto.timingSafeEqual(a, b)) return null;
  return agent;
}

export function loadConfig(path: string): Config {
  const raw = fs.readFileSync(path, 'utf-8');
  const parsed = YAML.parse(raw);
  const agents: Record<string, AgentConfig> = parsed.agents || {};
  const firstToken = Object.values(agents)[0]?.token || 'change-me';
  return {
    server: parsed.server || { port: 9222, host: '127.0.0.1' },
    agents,
    blocklist: parsed.blocklist || [],
    audit: parsed.audit || { logFile: './audit.jsonl', logToStdout: true },
    engine: parsed.engine || { binary: 'agent-browser', timeout: 30000 },
    dashboard: { port: parsed.dashboard?.port || 9334, adminToken: parsed.dashboard?.adminToken || firstToken },
  };
}

export function reloadConfig(path: string): Config {
  return loadConfig(path);
}
