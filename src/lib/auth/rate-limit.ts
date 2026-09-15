/**
 * Escalating login lockout (spec 0001, rule 11).
 *
 * A 6-digit PIN is a million combinations, which sounds like a lot until you
 * give a script a flat 15-minute window. An escalating delay makes the
 * twentieth attempt cost half an hour while the third still costs nothing —
 * which is the right shape, because the person who mistypes is a guest and
 * the person on attempt twenty is not.
 *
 * In memory on purpose: the roster is closed, and losing the counters on
 * restart is losing them on a deploy, which an attacker cannot trigger.
 */

/** Attempts that cost nothing. People mistype. */
const FREE_ATTEMPTS = 3;

/** The wait owed after failure number FREE_ATTEMPTS, FREE_ATTEMPTS+1, … */
const LADDER_MS = [
  10_000, // 10 s
  30_000, // 30 s
  60_000, // 1 min
  300_000, // 5 min
  600_000, // 10 min
  1_800_000, // 30 min, and every attempt after that
] as const;

/**
 * An hour of silence clears the ladder. Without it, a guest who fat-fingers
 * their PIN eight times on Friday evening faces 30-minute waits for the rest
 * of the weekend; an attacker still faces the whole ladder within any hour.
 */
const IDLE_RESET_MS = 60 * 60 * 1000;

type Bucket = { failures: number; lastFailureAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitState =
  | { blocked: false; attemptsLeft: number }
  | { blocked: true; retryInMs: number; waitMs: number; failures: number };

/** The wait owed after `failures` consecutive failures, in ms. 0 while free. */
export function waitAfter(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const step = Math.min(failures - FREE_ATTEMPTS, LADDER_MS.length - 1);
  return LADDER_MS[step] as number;
}

function live(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  if (now - bucket.lastFailureAt > IDLE_RESET_MS) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

export function checkRateLimit(key: string, now = Date.now()): RateLimitState {
  const bucket = live(key, now);
  if (!bucket) return { blocked: false, attemptsLeft: FREE_ATTEMPTS };

  const waitMs = waitAfter(bucket.failures);
  if (waitMs === 0) {
    return { blocked: false, attemptsLeft: FREE_ATTEMPTS - bucket.failures };
  }

  // Counted from the last failure, so retrying early neither shortens the wait
  // nor extends it (spec 0001, rule 11).
  const retryInMs = bucket.lastFailureAt + waitMs - now;
  if (retryInMs <= 0) return { blocked: false, attemptsLeft: 1 };

  return { blocked: true, retryInMs, waitMs, failures: bucket.failures };
}

export function recordFailure(key: string, now = Date.now()): void {
  const bucket = live(key, now);
  if (!bucket) {
    buckets.set(key, { failures: 1, lastFailureAt: now });
    return;
  }
  bucket.failures += 1;
  bucket.lastFailureAt = now;
}

/** Called on success: a correct PIN clears the ladder completely. */
export function clearFailures(key: string): void {
  buckets.delete(key);
}
