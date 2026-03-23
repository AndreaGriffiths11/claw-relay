// Wraps the agent-browser CLI binary. Each action becomes a subprocess
// call with structured args. We shell out rather than linking because
// agent-browser is Rust and may be swapped for any CDP-speaking binary.

import { execFile } from 'child_process';
import { ActionMessage } from './protocol';

export class Engine {
  constructor(
    private readonly binary: string,
    private readonly timeout: number,
  ) {}

  execute(msg: ActionMessage): Promise<{ ok: boolean; data?: string; error?: string }> {
    const args = this.buildArgs(msg);
    return new Promise((resolve) => {
      execFile(this.binary, args, { timeout: this.timeout }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, error: stderr?.trim() || err.message || 'Unknown engine error' });
        } else {
          resolve({ ok: true, data: stdout.trim() || undefined });
        }
      });
    });
  }

  // Cache the current URL briefly to avoid hammering the engine
  // on every non-navigate action's blocklist check
  private cachedUrl: string | null = null;
  private cachedUrlAt: number = 0;
  private readonly URL_CACHE_TTL_MS = 2000;

  getCurrentUrl(): Promise<string | null> {
    if (this.cachedUrl !== null && Date.now() - this.cachedUrlAt < this.URL_CACHE_TTL_MS) {
      return Promise.resolve(this.cachedUrl);
    }
    return new Promise((resolve) => {
      execFile(this.binary, ['get', 'url'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve(null);
        } else {
          this.cachedUrl = stdout.trim();
          this.cachedUrlAt = Date.now();
          resolve(this.cachedUrl);
        }
      });
    });
  }

  private buildArgs(msg: ActionMessage): string[] {
    switch (msg.type) {
      case 'snapshot':    return ['snapshot'];
      case 'screenshot':  return ['screenshot'];
      case 'close':       return ['close'];
      case 'click':       return ['click', msg.ref!];
      case 'hover':       return ['hover', msg.ref!];
      case 'fill':        return ['fill', msg.ref!, msg.text!];
      case 'type':        return ['type', msg.ref!, msg.text!];
      case 'press':       return ['press', msg.key!];
      case 'navigate':    return ['open', msg.url!];
      case 'evaluate':    return ['eval', msg.js!];
      case 'select':      return ['select', msg.ref!, ...(msg.values || [])];
      default:            return [];
    }
  }
}
