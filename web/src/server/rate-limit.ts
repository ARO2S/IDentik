/**
 * Simple in-memory sliding window rate limiter.
 * Works for single-process deployments. For multi-instance production,
 * replace with @upstash/ratelimit backed by Redis.
 */

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

// Clean up old entries every 5 minutes to prevent unbounded memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.timestamps.length === 0 || now - entry.timestamps[entry.timestamps.length - 1] > 60_000) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

/**
 * Returns true if the request is allowed, false if it should be rate-limited.
 * @param key      Unique key (e.g. "ip:route")
 * @param limit    Max requests allowed in the window
 * @param windowMs Window duration in milliseconds
 */
export function isAllowed(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;

  const entry = store.get(key) ?? { timestamps: [] };
  // Evict timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  entry.timestamps.push(now);
  store.set(key, entry);

  return entry.timestamps.length <= limit;
}
