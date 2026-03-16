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

export type IncomingMessage = AuthMessage | ActionMessage;
export type OutgoingMessage = ResultMessage | ErrorMessage;

export function parseMessage(raw: string): IncomingMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (!msg || !msg.type) return null;
    return msg as IncomingMessage;
  } catch {
    return null;
  }
}

export function isAuthMessage(msg: IncomingMessage): msg is AuthMessage {
  return msg.type === 'auth' && 'token' in msg && 'agent_id' in msg;
}

export function isActionMessage(msg: IncomingMessage): msg is ActionMessage {
  const actions = ['snapshot', 'click', 'fill', 'navigate', 'screenshot', 'evaluate', 'press', 'hover', 'select', 'type', 'close'];
  return actions.includes(msg.type);
}
