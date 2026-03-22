// Message types and validation

export interface AuthMessage {
  type: 'auth';
  token: string;
  agent_id: string;
}

export interface ActionMessage {
  type: 'snapshot' | 'click' | 'fill' | 'navigate' | 'screenshot' | 'evaluate' | 'press' | 'hover' | 'select' | 'type' | 'close';
  ref?: string;
  text?: string;
  url?: string;
  js?: string;
  key?: string;
  values?: string[];
  request_id?: string;
}

export interface ResultMessage {
  type: 'result';
  action: string;
  ok: boolean;
  data?: string;
  request_id?: string;
  mimeType?: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  request_id?: string;
}

export type IncomingMessage = AuthMessage | ActionMessage | { type: 'pong' };
export type OutgoingMessage = ResultMessage | ErrorMessage | { type: 'ping' };

const VALID_TYPES = new Set(['auth', 'snapshot', 'click', 'fill', 'navigate', 'screenshot', 'evaluate', 'press', 'hover', 'select', 'type', 'close', 'pong']);

export function parseMessage(raw: string): IncomingMessage | null {
  try {
    const msg = JSON.parse(raw);
    const hasValidStructure = msg && typeof msg.type === 'string';
    if (!hasValidStructure) return null;
    const isKnownType = VALID_TYPES.has(msg.type);
    if (!isKnownType) return null;
    return msg as IncomingMessage;
  } catch {
    return null;
  }
}

export function isAuthMessage(msg: IncomingMessage): msg is AuthMessage {
  const isAuthType = msg.type === 'auth';
  const hasToken = typeof (msg as any).token === 'string';
  const hasAgentId = typeof (msg as any).agent_id === 'string';
  return isAuthType && hasToken && hasAgentId;
}

const ACTIONS = new Set(['snapshot', 'click', 'fill', 'navigate', 'screenshot', 'evaluate', 'press', 'hover', 'select', 'type', 'close']);

// Required fields per action
const REQUIRED_FIELDS: Record<string, string[]> = {
  click: ['ref'], hover: ['ref'], fill: ['ref', 'text'], type: ['ref', 'text'],
  navigate: ['url'], evaluate: ['js'], press: ['key'], select: ['ref'],
};

export function isActionMessage(msg: IncomingMessage): msg is ActionMessage {
  const isValidAction = ACTIONS.has(msg.type);
  if (!isValidAction) return false;
  const required = REQUIRED_FIELDS[msg.type];
  if (required) {
    for (const field of required) {
      const fieldExists = field in msg;
      const fieldIsString = typeof (msg as any)[field] === 'string';
      if (!fieldExists || !fieldIsString) return false;
    }
  }
  return true;
}
