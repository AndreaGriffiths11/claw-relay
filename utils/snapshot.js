// Re-exported from content.js — standalone snapshot utility reference
// The actual snapshot logic lives in content.js since it runs in page context
// This file documents the snapshot format for external consumers

/**
 * Snapshot format:
 * {
 *   url: string,
 *   title: string,
 *   elements: Array<{
 *     ref: string,        // e.g. "e1", "e2"
 *     role: string,       // button, link, textbox, combobox, checkbox, etc.
 *     text?: string,      // visible text content
 *     label?: string,     // aria-label, placeholder, or associated label
 *     value?: string,     // current value (for inputs)
 *     selector: string,   // CSS selector to target element
 *   }>
 * }
 *
 * Roles captured:
 * - link (a[href])
 * - button (button, [role=button], input[type=submit|button])
 * - textbox (input, textarea)
 * - combobox (select)
 * - checkbox, radio
 * - tab, menuitem
 * - image (img[alt])
 * - heading (h1-h6)
 *
 * Max 500 elements per snapshot.
 * Only visible elements are included.
 */

module.exports = {
  MAX_ELEMENTS: 500,
  ROLES: ['link', 'button', 'textbox', 'combobox', 'checkbox', 'radio', 'tab', 'menuitem', 'image', 'heading'],
};
