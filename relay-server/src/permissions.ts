// Maps each browser action to the permission scope that gates it.
// Scopes are coarse by design: four levels cover the full action surface
// without requiring config changes every time we add an action.
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

export function hasPermission(scopes: readonly string[], action: string): boolean {
  const required = SCOPE_MAP[action];
  // Unknown actions are denied — fail closed
  if (!required) return false;
  return scopes.includes(required);
}
