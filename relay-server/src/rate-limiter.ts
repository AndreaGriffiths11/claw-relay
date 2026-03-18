export class RateLimiter {
  private tokens: Map<string, { count: number; lastReset: number; lastAccess: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  check(agentId: string, limit: number): boolean {
    const now = Date.now();
    let bucket = this.tokens.get(agentId);
    
    if (!bucket || now - bucket.lastReset >= 60000) {
      bucket = { count: 0, lastReset: now, lastAccess: now };
      this.tokens.set(agentId, bucket);
    }

    bucket.lastAccess = now;
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.tokens) {
      if (now - bucket.lastAccess > 300000) {
        this.tokens.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
