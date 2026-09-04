export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, maximum: number): RateLimitResult;
}

interface Counter {
  count: number;
  resetsAt: number;
}

export function createMinuteRateLimiter(now: () => number = Date.now): RateLimiter {
  const counters = new Map<string, Counter>();
  return {
    consume(key, maximum) {
      const timestamp = now();
      const existing = counters.get(key);
      const counter = !existing || existing.resetsAt <= timestamp
        ? { count: 0, resetsAt: timestamp + 60_000 }
        : existing;
      counter.count += 1;
      counters.set(key, counter);
      if (counters.size > 10_000) prune(counters, timestamp);
      return {
        allowed: counter.count <= maximum,
        retryAfterSeconds: Math.max(1, Math.ceil((counter.resetsAt - timestamp) / 1_000)),
      };
    },
  };
}

function prune(counters: Map<string, Counter>, timestamp: number): void {
  for (const [key, counter] of counters) if (counter.resetsAt <= timestamp) counters.delete(key);
}
