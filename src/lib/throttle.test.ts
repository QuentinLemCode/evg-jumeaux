import { describe, expect, it } from 'vitest';

import { createWindowLimiter } from './throttle';

const NOW = 1_700_000_000_000;

describe('createWindowLimiter', () => {
  it('allows up to the limit inside the window', () => {
    const limiter = createWindowLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.allow('a', NOW)).toBe(true);
    expect(limiter.allow('a', NOW)).toBe(true);
    expect(limiter.allow('a', NOW)).toBe(true);
    expect(limiter.allow('a', NOW)).toBe(false);
  });

  it('opens a fresh window once the old one elapsed', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow('a', NOW)).toBe(true);
    expect(limiter.allow('a', NOW + 59_999)).toBe(false);
    expect(limiter.allow('a', NOW + 60_000)).toBe(true);
  });

  it('counts keys independently', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.allow('a', NOW)).toBe(true);
    expect(limiter.allow('b', NOW)).toBe(true);
    expect(limiter.allow('a', NOW)).toBe(false);
  });

  it('does not grow without bound when sprayed with distinct keys', () => {
    // The failure this prevents: a public endpoint keyed on IP, given a
    // thousand forged addresses, holding a thousand windows forever.
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10 });
    for (let i = 0; i < 50; i += 1) {
      expect(limiter.allow(`key-${i}`, NOW + i)).toBe(true);
    }
    // The earliest keys were evicted, so they are allowed again rather than
    // remembered — which is the intended trade.
    expect(limiter.allow('key-0', NOW)).toBe(true);
  });

  it('resets one key or all of them', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 60_000 });
    limiter.allow('a', NOW);
    limiter.reset('a');
    expect(limiter.allow('a', NOW)).toBe(true);

    limiter.allow('a', NOW);
    limiter.reset();
    expect(limiter.allow('a', NOW)).toBe(true);
  });
});
