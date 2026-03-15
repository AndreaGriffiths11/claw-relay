// Claw Relay — Protocol Definition

const PROTOCOL = {
  version: '0.1.0',

  // Agent → Extension requests
  requests: {
    SNAPSHOT: 'snapshot',       // Get structured DOM snapshot
    CLICK: 'click',            // Click an element
    FILL: 'fill',              // Fill an input
    SELECT: 'select',          // Select an option
    NAVIGATE: 'navigate',      // Navigate to URL
    EVALUATE: 'evaluate',      // Execute JavaScript
    STATUS: 'status',          // Get relay status
  },

  // Extension → Agent responses
  responses: {
    SNAPSHOT_RESULT: 'snapshot_result',
    ACTION_RESULT: 'action_result',
    EVAL_RESULT: 'eval_result',
    STATUS_RESULT: 'status_result',
    ERROR: 'error',
    AUDIT_ENTRY: 'audit_entry',
  },

  // Permission scopes
  permissions: {
    READ: 'read',
    INTERACT: 'interact',
    NAVIGATE: 'navigate',
    EXECUTE: 'execute',
    FULL: 'full',
  },

  // Map request types to required permissions
  permissionMap: {
    snapshot: 'read',
    status: 'read',
    click: 'interact',
    fill: 'interact',
    select: 'interact',
    navigate: 'navigate',
    evaluate: 'execute',
  },
};

if (typeof module !== 'undefined') module.exports = PROTOCOL;
