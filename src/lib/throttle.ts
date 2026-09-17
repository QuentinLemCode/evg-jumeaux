/**
 * A fixed-window rate limiter, in memory.
 *
 * Used by the public client-error endpoint (spec 0011, rule 10), which takes
 * no session and therefore has to defend itself. Distinct from
 * `src/lib/auth/rate-limit.ts`, which implements an escalating lockout: that
 * one is about making a guessing attack expensive, this one is about a page
 * stuck in a render loop not writing a thousand rows a second.
 *
 * In memory, and lost on restart, for the same reason as the login limiter:
 * the roster is closed and a restart is a deploy, not something an attacker
 * can trigger.
 */
export type WindowLimiter = {
  allow(key: string, now?: number): boolean;
  reset(key?: string): void;
};

export function createWindowLimiter(options: {
  limit: number;
  windowMs: number;
  /** Beyond this many distinct keys, the oldest windows are dropped. */
  maxKeys?: number;
}): WindowLimiter {
  const { limit, windowMs, maxKeys = 5_000 } = options;
  const windows = new Map<string, { count: number; startedAt: number }>();

  return {
    allow(key, now = Date.now()) {
      const existing = windows.get(key);
      if (!existing || now - existing.startedAt >= windowMs) {
        // A bound on the map, so a spray of distinct keys cannot grow it
        // without limit. Dropping the oldest is the right trade here: the
        // cost of wrongly allowing one extra report is a row.
        if (windows.size >= maxKeys) {
          const oldest = [...windows.entries()].sort(
            (a, b) => a[1].startedAt - b[1].startedAt,
          )[0];
          if (oldest) windows.delete(oldest[0]);
        }
        windows.set(key, { count: 1, startedAt: now });
        return true;
      }
      if (existing.count >= limit) return false;
      existing.count += 1;
      return true;
    },

    reset(key) {
      if (key === undefined) windows.clear();
      else windows.delete(key);
    },
  };
}
