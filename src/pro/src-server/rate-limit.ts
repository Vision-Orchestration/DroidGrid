/**
 * M1: In-memory rate limiter (token bucket per IP).
 *
 * Factory pattern with injectable clock for testability.
 */

interface RateLimiterOptions {
  maxTokens?: number;
  windowMs?: number;
  now?: () => number;
}

interface RateLimiter {
  rateLimit(
    req: { ip?: string; headers: Record<string, string | string[] | undefined> },
    res: { status: (code: number) => { json: (data: unknown) => void } },
  ): boolean;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const maxTokens = options.maxTokens ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;

  const buckets = new Map<string, { tokens: number; lastRefill: number }>();

  // Stale bucket GC every 2 windows
  setInterval(() => {
    const t = now();
    for (const [key, bucket] of buckets) {
      if (t - bucket.lastRefill > windowMs * 2) {
        buckets.delete(key);
      }
    }
  }, windowMs * 2).unref();

  return {
    rateLimit(req, res) {
      const forwarded = req.headers["x-forwarded-for"];
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.ip ?? "unknown";

      const t = now();
      let bucket = buckets.get(ip);

      if (!bucket || t - bucket.lastRefill > windowMs) {
        bucket = { tokens: maxTokens, lastRefill: t };
        buckets.set(ip, bucket);
      }

      const elapsed = t - bucket.lastRefill;
      const refill = Math.floor((elapsed / windowMs) * maxTokens);
      if (refill > 0) {
        bucket.tokens = Math.min(maxTokens, bucket.tokens + refill);
        bucket.lastRefill = t;
      }

      if (bucket.tokens <= 0) {
        res.status(429).json({ error: "Too many requests" });
        return true;
      }

      bucket.tokens -= 1;
      return false;
    },
  };
}

/** Default production instance */
export const rateLimit = createRateLimiter().rateLimit;
