// Tracks connected agents and their activity for the dashboard.
// All state lives in-memory — restarting the relay resets counters.

export interface AgentState {
  readonly agentId: string;
  readonly connectedAt: string;
  lastAction: string | null;
  lastActionAt: string | null;
  actionCount: number;
}

const connections = new Map<string, AgentState>();
const serverStartedAt = new Date().toISOString();

export function agentConnected(agentId: string): void {
  connections.set(agentId, {
    agentId,
    connectedAt: new Date().toISOString(),
    lastAction: null,
    lastActionAt: null,
    actionCount: 0,
  });
}

export function agentDisconnected(agentId: string): void {
  connections.delete(agentId);
}

export function agentAction(agentId: string, action: string): void {
  const state = connections.get(agentId);
  if (!state) return;
  state.lastAction = action;
  state.lastActionAt = new Date().toISOString();
  state.actionCount++;
}

export function getState(): { connections: AgentState[]; startedAt: string } {
  return {
    connections: Array.from(connections.values()),
    startedAt: serverStartedAt,
  };
}
