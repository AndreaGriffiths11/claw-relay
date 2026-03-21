export class RateLimiter {
  private tokens: Map<string, { count: number; lastReset: number; lastAccess: number }> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  check(agentId: string, limit: number): boolean {
    const now = Date.now();
    let bucket = this.tokens.get(agentId);
    
    const timeSinceReset = bucket ? now - bucket.lastReset : Infinity;
    const needsReset = !bucket || timeSinceReset >= 60000;
    if (needsReset) {
      bucket = { count: 0, lastReset: now, lastAccess: now };
      this.tokens.set(agentId, bucket);
    }

    const activeBucket = bucket!;
    activeBucket.lastAccess = now;
    const isOverLimit = activeBucket.count >= limit;
    if (isOverLimit) return false;
    activeBucket.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.tokens) {
      const timeSinceAccess = now - bucket.lastAccess;
      const isExpired = timeSinceAccess > 300000;
      if (isExpired) {
        this.tokens.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
