// Protocol types for the WebSocket wire format.
// Keep in sync with docs/protocol.md — any field added here
// should be documented there.

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

const VALID_TYPES = new Set([
  'auth', 'snapshot', 'click', 'fill', 'navigate', 'screenshot',
  'evaluate', 'press', 'hover', 'select', 'type', 'close', 'pong',
]);

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
  return msg.type === 'auth'
    && typeof (msg as AuthMessage).token === 'string'
    && typeof (msg as AuthMessage).agent_id === 'string';
}

// Fields that must be present for each action type.
// Actions not listed here (snapshot, screenshot, close) need no extra fields.
const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  click: ['ref'],
  hover: ['ref'],
  fill: ['ref', 'text'],
  type: ['ref', 'text'],
  navigate: ['url'],
  evaluate: ['js'],
  press: ['key'],
  select: ['ref'],
};

const ACTIONS = new Set(Object.keys(REQUIRED_FIELDS).concat('snapshot', 'screenshot', 'close'));

export function isActionMessage(msg: IncomingMessage): msg is ActionMessage {
  if (!ACTIONS.has(msg.type)) return false;

  const required = REQUIRED_FIELDS[msg.type];
  if (!required) return true;

  for (const field of required) {
    if (typeof (msg as Record<string, unknown>)[field] !== 'string') return false;
  }
  return true;
}
