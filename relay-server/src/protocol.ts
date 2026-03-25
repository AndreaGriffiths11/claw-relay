// Protocol types for the WebSocket wire format.
// Keep in sync with docs/protocol.md — any field added here
// should be documented there.

export interface AuthMessage {
  type: 'auth';
  token: string;
  agent_id: string;
}

export interface ActionMessage {
  type: 'snapshot' | 'click' | 'fill' | 'navigate' | 'screenshot' | 'evaluate' | 'press' | 'hover' | 'select' | 'type' | 'close' | 'drag' | 'scrollIntoView' | 'wait' | 'resize' | 'batch' | 'console' | 'network' | 'pdf';
  ref?: string;
  selector?: string;
  text?: string;
  url?: string;
  js?: string;
  key?: string;
  values?: string[];
  request_id?: string;
  targetId?: string;
  doubleClick?: boolean;
  button?: string;
  modifiers?: string[];
  delayMs?: number;
  timeoutMs?: number;
  startRef?: string;
  endRef?: string;
  textGone?: string;
  loadState?: string;
  fn?: string;
  timeMs?: number;
  width?: number;
  height?: number;
  fields?: Array<{ ref: string; type: string; value?: string | number | boolean }>;
  actions?: ActionMessage[];
  stopOnError?: boolean;
  submit?: boolean;
  slowly?: boolean;
  fullPage?: boolean;
  element?: string;
  imageType?: string;
  level?: string;
  filter?: string;
  clear?: boolean;
}

export interface ResultMessage {
  type: 'result';
  action: string;
  ok: boolean;
  data?: string;
  request_id?: string;
  mimeType?: string;
  targetId?: string;
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
  'drag', 'scrollIntoView', 'wait', 'resize', 'batch', 'console', 'network', 'pdf',
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

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  click: [],
  hover: [],
  fill: [],
  type: [],
  navigate: ['url'],
  evaluate: [],
  press: ['key'],
  select: [],
  drag: [],
  scrollIntoView: [],
  wait: [],
  resize: ['width', 'height'],
  batch: ['actions'],
};

const ACTIONS = new Set(Object.keys(REQUIRED_FIELDS).concat('snapshot', 'screenshot', 'close', 'console', 'network', 'pdf'));

export function isActionMessage(msg: IncomingMessage): msg is ActionMessage {
  if (!ACTIONS.has(msg.type)) return false;

  const required = REQUIRED_FIELDS[msg.type];
  if (!required) return true;

  for (const field of required) {
    if ((msg as Record<string, unknown>)[field] === undefined) return false;
  }
  return true;
}
