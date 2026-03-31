// Maps each browser action to the permission scope that gates it.
// Scopes are coarse by design: four levels cover the full action surface
// without requiring config changes every time we add an action.
const SCOPE_MAP: Record<string, string> = {
  snapshot: 'read',
  screenshot: 'read',
  console: 'read',
  network: 'read',
  pdf: 'read',
  click: 'interact',
  type: 'interact',
  fill: 'interact',
  press: 'interact',
  hover: 'interact',
  select: 'interact',
  drag: 'interact',
  scrollIntoView: 'interact',
  navigate: 'navigate',
  close: 'navigate',
  resize: 'navigate',
  evaluate: 'execute',
  wait: 'read',
  batch: 'interact',
};

// --- Denial Tracking ---
// Inspired by Claude Code's permission classifier fallback pattern.
// Tracks consecutive and total denials per agent. After thresholds are hit,
// surfaces warnings so operators can fix misconfigured scopes rather than
// agents silently failing in a loop.

export interface DenialState {
  consecutive: number;
  total: number;
  lastAction?: string;
  lastTimestamp?: number;
}

const DENIAL_LIMITS = {
  maxConsecutive: 3,
  maxTotal: 20,
} as const;

const denialStates = new Map<string, DenialState>();

export function getDenialState(agentId: string): DenialState {
  return denialStates.get(agentId) ?? { consecutive: 0, total: 0 };
}

export function recordDenial(agentId: string, action: string): DenialState {
  const prev = getDenialState(agentId);
  const next: DenialState = {
    consecutive: prev.consecutive + 1,
    total: prev.total + 1,
    lastAction: action,
    lastTimestamp: Date.now(),
  };
  denialStates.set(agentId, next);
  return next;
}

export function recordSuccess(agentId: string): void {
  const prev = denialStates.get(agentId);
  if (!prev || prev.consecutive === 0) return;
  denialStates.set(agentId, { ...prev, consecutive: 0 });
}

export function shouldWarn(state: DenialState): boolean {
  return (
    state.consecutive >= DENIAL_LIMITS.maxConsecutive ||
    state.total >= DENIAL_LIMITS.maxTotal
  );
}

export function getDenialWarning(agentId: string, state: DenialState): string {
  if (state.consecutive >= DENIAL_LIMITS.maxConsecutive) {
    return `Agent "${agentId}" denied ${state.consecutive} times consecutively (last action: ${state.lastAction}). Check agent scopes.`;
  }
  return `Agent "${agentId}" has ${state.total} total denials. Consider reviewing scope configuration.`;
}

export function getAllDenialStates(): Record<string, DenialState> {
  return Object.fromEntries(denialStates);
}

export function resetDenialState(agentId: string): void {
  denialStates.delete(agentId);
}

// --- Permission Check ---

export function hasPermission(scopes: readonly string[], action: string, msg?: { fn?: string }): boolean {
  let required = SCOPE_MAP[action];
  // Unknown actions are denied — fail closed
  if (!required) return false;
  // wait + fn runs arbitrary JS — require execute scope
  if (action === 'wait' && msg?.fn) required = 'execute';
  return scopes.includes(required);
}
