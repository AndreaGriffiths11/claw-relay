// Claw Relay — Permission Scope Management

const SCOPES = {
  read: { label: 'Read', description: 'Snapshots and page info only', risk: 'low' },
  interact: { label: 'Interact', description: 'Click, fill, select elements', risk: 'medium' },
  navigate: { label: 'Navigate', description: 'Change page URLs', risk: 'medium' },
  execute: { label: 'Execute', description: 'Run arbitrary JavaScript', risk: 'high' },
  full: { label: 'Full', description: 'All permissions', risk: 'high' },
};

const DEFAULT_PERMISSIONS = ['read', 'interact'];

function checkPermission(action, grantedPermissions) {
  const permMap = {
    snapshot: 'read',
    status: 'read',
    click: 'interact',
    fill: 'interact',
    select: 'interact',
    navigate: 'navigate',
    evaluate: 'execute',
  };
  const needed = permMap[action] || 'full';
  return grantedPermissions.includes(needed) || grantedPermissions.includes('full');
}

if (typeof module !== 'undefined') {
  module.exports = { SCOPES, DEFAULT_PERMISSIONS, checkPermission };
}
