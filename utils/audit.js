// Claw Relay — Audit Logger

class AuditLog {
  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  add(action, detail, meta = {}) {
    const entry = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
      timestamp: Date.now(),
      action,
      detail,
      ...meta,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return entry;
  }

  clear() {
    this.entries = [];
  }

  getAll() {
    return [...this.entries];
  }

  getRecent(n = 50) {
    return this.entries.slice(-n);
  }

  toJSON() {
    return this.entries;
  }
}

if (typeof module !== 'undefined') module.exports = AuditLog;
