import * as fs from 'fs';

export class AuditLogger {
  private stream: fs.WriteStream | null = null;
  private logToStdout: boolean;

  constructor(logFile: string, logToStdout: boolean = true) {
    this.stream = fs.createWriteStream(logFile, { flags: 'a' });
    this.logToStdout = logToStdout;
  }

  log(entry: { agent_id: string; action: string; target?: string; ok: boolean; duration_ms: number; error?: string }) {
    const timestamp = new Date().toISOString();
    const record = { timestamp, ...entry };
    const line = JSON.stringify(record);
    const lineWithNewline = line + '\n';
    this.stream?.write(lineWithNewline);
    if (this.logToStdout) console.log(line);
  }
}

/**
 * Read the last N lines from a file efficiently by reading chunks from the end.
 */
export function tailLines(filePath: string, count: number = 200): string[] {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return [];
  }

  try {
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;
    if (fileSize === 0) return [];

    const CHUNK = 8192;
    const lines: string[] = [];
    let remainder = '';
    let pos = fileSize;

    while (pos > 0 && lines.length < count) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, pos);
      const chunk = buf.toString('utf-8') + remainder;
      const parts = chunk.split('\n');
      // First element is partial (or beginning of file) — save as remainder
      remainder = parts[0];
      // Rest are complete lines (last split element may be empty from trailing \n)
      for (let i = parts.length - 1; i >= 1; i--) {
        if (parts[i].length > 0) {
          lines.push(parts[i]);
          if (lines.length >= count) break;
        }
      }
    }

    // If we consumed the whole file, remainder is the first line
    if (pos === 0 && remainder.length > 0 && lines.length < count) {
      lines.push(remainder);
    }

    return lines.reverse();
  } finally {
    fs.closeSync(fd);
  }
}
