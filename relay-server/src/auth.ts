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
  const storedHash = crypto.createHash('sha256');
  storedHash.update(agent.token);
  const storedTokenHash = storedHash.digest();
  const providedHash = crypto.createHash('sha256');
  providedHash.update(token);
  const providedTokenHash = providedHash.digest();
  const tokensMatch = crypto.timingSafeEqual(storedTokenHash, providedTokenHash);
  if (!tokensMatch) return null;
  return agent;
}

export function loadConfig(path: string): Config {
  const raw = fs.readFileSync(path, 'utf-8');
  const parsed = YAML.parse(raw);
  const agents: Record<string, AgentConfig> = parsed.agents || {};
  const server = parsed.server || { port: 9222, host: '127.0.0.1' };
  const blocklist = parsed.blocklist || [];
  const audit = parsed.audit || { logFile: './audit.jsonl', logToStdout: true };
  const engine = parsed.engine || { binary: 'agent-browser', timeout: 30_000 };
  const dashboardPort = parsed.dashboard?.port || 9334;
  const dashboardAdminToken = parsed.dashboard?.adminToken || '';
  const dashboard = { port: dashboardPort, adminToken: dashboardAdminToken };
  return { server, agents, blocklist, audit, engine, dashboard };
}

export function reloadConfig(path: string): Config {
  return loadConfig(path);
}
