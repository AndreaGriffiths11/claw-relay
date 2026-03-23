// Token bucket rate limiter — one bucket per agent ID.
// Buckets reset every RATE_WINDOW_MS. Idle buckets are evicted
// after BUCKET_EXPIRY_MS to avoid unbounded memory growth.

const RATE_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;
const BUCKET_EXPIRY_MS = 300_000;

interface Bucket {
  count: number;
  lastReset: number;
  lastAccess: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.evictStale(), CLEANUP_INTERVAL_MS);
  }

  /** Returns true if the action is allowed, false if rate-limited. */
  check(agentId: string, limit: number): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(agentId);

    if (!bucket || now - bucket.lastReset >= RATE_WINDOW_MS) {
      bucket = { count: 0, lastReset: now, lastAccess: now };
      this.buckets.set(agentId, bucket);
    }

    bucket.lastAccess = now;
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastAccess > BUCKET_EXPIRY_MS) {
        this.buckets.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
