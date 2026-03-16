export class RateLimiter {
  private tokens: Map<string, { count: number; lastReset: number }> = new Map();

  check(agentId: string, limit: number): boolean {
    const now = Date.now();
    let bucket = this.tokens.get(agentId);
    
    if (!bucket || now - bucket.lastReset >= 60000) {
      bucket = { count: 0, lastReset: now };
      this.tokens.set(agentId, bucket);
    }

    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }
}
