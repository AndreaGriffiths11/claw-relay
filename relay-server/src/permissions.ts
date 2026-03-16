const SCOPE_MAP: Record<string, string> = {
  snapshot: 'read',
  screenshot: 'read',
  click: 'interact',
  type: 'interact',
  fill: 'interact',
  press: 'interact',
  hover: 'interact',
  select: 'interact',
  navigate: 'navigate',
  close: 'navigate',
  evaluate: 'execute',
};

export function getRequiredScope(action: string): string | null {
  return SCOPE_MAP[action] || null;
}

export function hasPermission(scopes: string[], action: string): boolean {
  const required = getRequiredScope(action);
  if (!required) return false;
  return scopes.includes(required);
}
