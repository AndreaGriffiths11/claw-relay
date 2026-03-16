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
          resolve({ ok: false, error: stderr || err.message });
        } else {
          resolve({ ok: true, data: stdout.trim() || undefined });
        }
      });
    });
  }

  getCurrentUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(this.binary, ['get', 'url'], { timeout: 5000 }, (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout.trim());
      });
    });
  }
}
