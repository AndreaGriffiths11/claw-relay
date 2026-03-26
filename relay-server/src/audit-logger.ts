import * as fs from 'fs';

// Append-only JSONL audit log. Each line is a self-contained JSON record
// with timestamp, agent, action, and outcome. Designed for grep/jq analysis.

export class AuditLogger {
  private stream: fs.WriteStream;
  private readonly logFile: string;
  private readonly logToStdout: boolean;

  constructor(logFile: string, logToStdout: boolean = true) {
    this.logFile = logFile;
    this.stream = fs.createWriteStream(logFile, { flags: 'a' });
    this.logToStdout = logToStdout;
  }

  log(entry: {
    agent_id: string;
    action: string;
    target?: string;
    ok: boolean;
    duration_ms: number;
    error?: string;
  }): void {
    const record = { timestamp: new Date().toISOString(), ...entry };
    const line = JSON.stringify(record);
    this.stream.write(line + '\n');
    if (this.logToStdout) console.log(line);
  }

  /** Truncate the log file and reopen the write stream at position 0. */
  clear(): void {
    this.stream.end();
    fs.writeFileSync(this.logFile, '', 'utf-8');
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }
}

/**
 * Read the last N lines from a file by scanning backward in chunks.
 * Used by the dashboard to show recent audit entries without loading
 * the entire log into memory.
 */
export function tailLines(filePath: string, count: number = 200): string[] {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return [];
  }

  try {
    const fileSize = fs.fstatSync(fd).size;
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
      const parts = (buf.toString('utf-8') + remainder).split('\n');
      remainder = parts[0];
      for (let i = parts.length - 1; i >= 1; i--) {
        if (parts[i].length > 0) {
          lines.push(parts[i]);
          if (lines.length >= count) break;
        }
      }
    }

    // Remaining content at file start is the first line
    if (pos === 0 && remainder.length > 0 && lines.length < count) {
      lines.push(remainder);
    }

    return lines.reverse();
  } finally {
    fs.closeSync(fd);
  }
}
