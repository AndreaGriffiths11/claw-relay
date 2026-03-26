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

export function hasPermission(scopes: readonly string[], action: string, msg?: { fn?: string }): boolean {
  let required = SCOPE_MAP[action];
  // Unknown actions are denied — fail closed
  if (!required) return false;
  // wait + fn runs arbitrary JS — require execute scope
  if (action === 'wait' && msg?.fn) required = 'execute';
  return scopes.includes(required);
}
