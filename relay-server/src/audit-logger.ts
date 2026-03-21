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
