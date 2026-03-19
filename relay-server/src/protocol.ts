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
}

export interface ResultMessage {
  type: 'result';
  action: string;
  ok: boolean;
  data?: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type IncomingMessage = AuthMessage | ActionMessage | { type: 'pong' };
export type OutgoingMessage = ResultMessage | ErrorMessage | { type: 'ping' };

const VALID_TYPES = new Set(['auth', 'snapshot', 'click', 'fill', 'navigate', 'screenshot', 'evaluate', 'press', 'hover', 'select', 'type', 'close', 'pong']);

export function parseMessage(raw: string): IncomingMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.type !== 'string') return null;
    if (!VALID_TYPES.has(msg.type)) return null;
    return msg as IncomingMessage;
  } catch {
    return null;
  }
}

export function isAuthMessage(msg: IncomingMessage): msg is AuthMessage {
  return msg.type === 'auth' && typeof (msg as any).token === 'string' && typeof (msg as any).agent_id === 'string';
}

const ACTIONS = new Set(['snapshot', 'click', 'fill', 'navigate', 'screenshot', 'evaluate', 'press', 'hover', 'select', 'type', 'close']);

// Required fields per action
const REQUIRED_FIELDS: Record<string, string[]> = {
  click: ['ref'], hover: ['ref'], fill: ['ref', 'text'], type: ['ref', 'text'],
  navigate: ['url'], evaluate: ['js'], press: ['key'], select: ['ref'],
};

export function isActionMessage(msg: IncomingMessage): msg is ActionMessage {
  if (!ACTIONS.has(msg.type)) return false;
  const required = REQUIRED_FIELDS[msg.type];
  if (required) {
    for (const field of required) {
      if (!(field in msg) || typeof (msg as any)[field] !== 'string') return false;
    }
  }
  return true;
}
