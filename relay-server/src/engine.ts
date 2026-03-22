import { execFile } from 'child_process';
import { ActionMessage } from './protocol';

export class Engine {
  private binary: string;
  private timeout: number;

  constructor(binary: string, timeout: number) {
    this.binary = binary;
    this.timeout = timeout;
  }

  private buildArgs(msg: ActionMessage): string[] {
    switch (msg.type) {
      case 'snapshot': return ['snapshot'];
      case 'screenshot': return ['screenshot'];
      case 'close': return ['close'];
      case 'click': return ['click', msg.ref!];
      case 'hover': return ['hover', msg.ref!];
      case 'fill': return ['fill', msg.ref!, msg.text!];
      case 'type': return ['type', msg.ref!, msg.text!];
      case 'press': return ['press', msg.key!];
      case 'navigate': return ['open', msg.url!];
      case 'evaluate': return ['eval', msg.js!];
      case 'select': return ['select', msg.ref!, ...(msg.values || [])];
      default: return [];
    }
  }

  execute(msg: ActionMessage): Promise<{ ok: boolean; data?: string; error?: string }> {
    const args = this.buildArgs(msg);
    return new Promise((resolve) => {
      execFile(this.binary, args, { timeout: this.timeout }, (err, stdout, stderr) => {
        if (err) {
          const stderrTrimmed = stderr?.trim();
          const errorMsg = stderrTrimmed || err.message || 'Unknown engine error';
          resolve({ ok: false, error: errorMsg });
        } else {
          const stdoutTrimmed = stdout.trim();
          const data = stdoutTrimmed || undefined;
          resolve({ ok: true, data });
        }
      });
    });
  }

  private cachedUrl: string | null = null;
  private cachedUrlAt: number = 0;

  getCurrentUrl(): Promise<string | null> {
    const now = Date.now();
    const cacheAge = now - this.cachedUrlAt;
    const cacheIsValid = this.cachedUrl !== null && cacheAge < 2000;
    if (cacheIsValid) {
      return Promise.resolve(this.cachedUrl);
    }
    return new Promise((resolve) => {
      execFile(this.binary, ['get', 'url'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve(null);
        } else {
          const url = stdout.trim();
          this.cachedUrl = url;
          this.cachedUrlAt = Date.now();
          resolve(url);
        }
      });
    });
  }
}
