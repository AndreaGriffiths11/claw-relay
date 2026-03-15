// Claw Relay — Content Script
// Injected on demand to interact with page DOM

(() => {
  if (window.__clawRelayInjected) return;
  window.__clawRelayInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg).then(sendResponse).catch(err => {
      sendResponse({ type: 'error', error: err.message });
    });
    return true;
  });

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'snapshot': return takeSnapshot();
      case 'click': return doClick(msg);
      case 'fill': return doFill(msg);
      case 'select': return doSelect(msg);
      case 'evaluate': return doEvaluate(msg);
      default: return { type: 'error', error: `Unknown action: ${msg.type}` };
    }
  }

  function takeSnapshot() {
    const elements = [];
    let refCounter = 0;

    const selectors = [
      { sel: 'a[href]', role: 'link' },
      { sel: 'button, [role="button"], input[type="submit"], input[type="button"]', role: 'button' },
      { sel: 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea', role: 'textbox' },
      { sel: 'select', role: 'combobox' },
      { sel: '[role="checkbox"], input[type="checkbox"]', role: 'checkbox' },
      { sel: '[role="radio"], input[type="radio"]', role: 'radio' },
      { sel: '[role="tab"]', role: 'tab' },
      { sel: '[role="menuitem"]', role: 'menuitem' },
      { sel: 'img[alt]', role: 'image' },
      { sel: 'h1, h2, h3, h4, h5, h6', role: 'heading' },
    ];

    for (const { sel, role } of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        refCounter++;
        const ref = `e${refCounter}`;
        const entry = { ref, role };

        // Text content
        const text = el.textContent?.trim().slice(0, 200) ||
                     el.getAttribute('aria-label') ||
                     el.getAttribute('title') ||
                     el.getAttribute('alt') || '';
        if (text) entry.text = text;

        // Label for inputs
        const label = el.getAttribute('aria-label') ||
                      el.getAttribute('placeholder') ||
                      getLabelText(el);
        if (label && label !== text) entry.label = label;

        // Value
        if (el.value !== undefined && el.value !== '') entry.value = el.value;

        // Generate a unique selector
        entry.selector = getUniqueSelector(el);

        // Store ref on element for quick access
        el.dataset.clawRef = ref;

        elements.push(entry);
        if (elements.length >= 500) break;
      }
      if (elements.length >= 500) break;
    }

    return {
      type: 'snapshot_result',
      url: location.href,
      title: document.title,
      elements,
    };
  }

  function doClick(msg) {
    const el = findElement(msg);
    if (!el) return { type: 'error', error: `Element not found: ${msg.selector || msg.ref}` };
    el.click();
    return { type: 'action_result', success: true, action: 'click', target: msg.selector || msg.ref };
  }

  function doFill(msg) {
    const el = findElement(msg);
    if (!el) return { type: 'error', error: `Element not found: ${msg.selector || msg.ref}` };
    el.focus();
    el.value = msg.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { type: 'action_result', success: true, action: 'fill', target: msg.selector || msg.ref };
  }

  function doSelect(msg) {
    const el = findElement(msg);
    if (!el) return { type: 'error', error: `Element not found: ${msg.selector || msg.ref}` };
    el.value = msg.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { type: 'action_result', success: true, action: 'select', target: msg.selector || msg.ref };
  }

  function doEvaluate(msg) {
    try {
      const result = eval(msg.script);
      return { type: 'eval_result', success: true, result: String(result) };
    } catch (err) {
      return { type: 'error', error: err.message };
    }
  }

  function findElement(msg) {
    if (msg.ref) return document.querySelector(`[data-claw-ref="${msg.ref}"]`);
    if (msg.selector) return document.querySelector(msg.selector);
    return null;
  }

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent?.trim().slice(0, 100);
    }
    const parent = el.closest('label');
    if (parent) return parent.textContent?.trim().slice(0, 100);
    return '';
  }

  function getUniqueSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    
    // Try aria-label
    const aria = el.getAttribute('aria-label');
    if (aria) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;

    // Try name attribute
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

    // Build path
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const siblings = current.parentElement?.children;
      if (siblings && siblings.length > 1) {
        const idx = Array.from(siblings).indexOf(current) + 1;
        selector += `:nth-child(${idx})`;
      }
      parts.unshift(selector);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
})();
