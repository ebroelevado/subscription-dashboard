interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

function now(): number {
  return Date.now();
}

function getBucket(cacheKey: string, windowMs: number): RateLimitBucket {
  const currentTime = now();
  const existing = buckets.get(cacheKey);

  if (!existing || existing.resetAt <= currentTime) {
    const fresh = {
      count: 0,
      resetAt: currentTime + windowMs,
    };
    buckets.set(cacheKey, fresh);
    return fresh;
  }

  return existing;
}

function cleanupBuckets(): void {
  const currentTime = now();
  for (const [cacheKey, bucket] of buckets.entries()) {
    if (bucket.resetAt <= currentTime) {
      buckets.delete(cacheKey);
    }
  }
}

export function checkRateLimit(input: RateLimitInput): RateLimitResult {
  cleanupBuckets();

  const cacheKey = `${input.key}:${input.windowMs}:${input.limit}`;
  const bucket = getBucket(cacheKey, input.windowMs);

  if (bucket.count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, bucket.resetAt - now()),
    };
  }

  bucket.count += 1;
  buckets.set(cacheKey, bucket);

  return {
    allowed: true,
    remaining: Math.max(0, input.limit - bucket.count),
    retryAfterMs: Math.max(0, bucket.resetAt - now()),
  };
}
