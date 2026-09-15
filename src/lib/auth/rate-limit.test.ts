import { beforeEach, describe, expect, it } from 'vitest';

import { checkRateLimit, clearFailures, recordFailure, waitAfter } from './rate-limit';

const NOW = 1_700_000_000_000;
const KEY = 'alice';
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Fails `n` times in a row, all at `at`. */
function failTimes(n: number, at = NOW) {
  for (let i = 0; i < n; i += 1) recordFailure(KEY, at);
}

describe('the escalating ladder', () => {
  it('charges nothing for the first three attempts', () => {
    expect(waitAfter(0)).toBe(0);
    expect(waitAfter(1)).toBe(0);
    expect(waitAfter(2)).toBe(0);
  });

  it('climbs 10 s → 30 s → 1 min → 5 min → 10 min → 30 min', () => {
    expect(waitAfter(3)).toBe(10 * SECOND);
    expect(waitAfter(4)).toBe(30 * SECOND);
    expect(waitAfter(5)).toBe(1 * MINUTE);
    expect(waitAfter(6)).toBe(5 * MINUTE);
    expect(waitAfter(7)).toBe(10 * MINUTE);
    expect(waitAfter(8)).toBe(30 * MINUTE);
  });

  it('stays at 30 minutes forever after', () => {
    expect(waitAfter(9)).toBe(30 * MINUTE);
    expect(waitAfter(40)).toBe(30 * MINUTE);
    expect(waitAfter(1000)).toBe(30 * MINUTE);
  });
});

describe('login rate limiting', () => {
  beforeEach(() => clearFailures(KEY));

  it('allows a first attempt', () => {
    expect(checkRateLimit(KEY, NOW)).toEqual({ blocked: false, attemptsLeft: 3 });
  });

  it('counts down the free attempts', () => {
    failTimes(1);
    expect(checkRateLimit(KEY, NOW)).toEqual({ blocked: false, attemptsLeft: 2 });
    failTimes(1);
    expect(checkRateLimit(KEY, NOW)).toEqual({ blocked: false, attemptsLeft: 1 });
  });

  it('blocks the fourth attempt for ten seconds', () => {
    failTimes(3);
    const state = checkRateLimit(KEY, NOW);
    expect(state.blocked).toBe(true);
    if (!state.blocked) throw new Error('unreachable');
    expect(state.retryInMs).toBe(10 * SECOND);
    expect(state.waitMs).toBe(10 * SECOND);
  });

  it('lets the fourth attempt through once the ten seconds elapsed', () => {
    failTimes(3);
    expect(checkRateLimit(KEY, NOW + 10 * SECOND).blocked).toBe(false);
  });

  it('counts the wait from the LAST failure, so an early retry does not help', () => {
    failTimes(3);
    // still blocked 9 s in…
    expect(checkRateLimit(KEY, NOW + 9 * SECOND).blocked).toBe(true);
    // …and a further failure 9 s in restarts the clock at the next rung
    recordFailure(KEY, NOW + 9 * SECOND);
    const state = checkRateLimit(KEY, NOW + 10 * SECOND);
    expect(state.blocked).toBe(true);
    if (!state.blocked) throw new Error('unreachable');
    expect(state.retryInMs).toBe(29 * SECOND);
  });

  it('reports a shrinking countdown', () => {
    failTimes(6);
    const state = checkRateLimit(KEY, NOW + 2 * MINUTE);
    expect(state).toMatchObject({ blocked: true, retryInMs: 3 * MINUTE });
  });

  it('caps the wait at thirty minutes however many times you fail', () => {
    failTimes(25);
    const state = checkRateLimit(KEY, NOW);
    if (!state.blocked) throw new Error('unreachable');
    expect(state.waitMs).toBe(30 * MINUTE);
  });

  it('clears the ladder on a successful login', () => {
    failTimes(8);
    clearFailures(KEY);
    expect(checkRateLimit(KEY, NOW)).toEqual({ blocked: false, attemptsLeft: 3 });
  });

  it('clears the ladder after an hour of silence', () => {
    failTimes(8);
    expect(checkRateLimit(KEY, NOW + 61 * MINUTE)).toEqual({
      blocked: false,
      attemptsLeft: 3,
    });
  });

  it('does not clear it just before the hour is up', () => {
    failTimes(8);
    // 59 minutes of silence: the 30-minute wait has elapsed, so an attempt is
    // allowed — but the ladder itself has not been forgotten.
    expect(checkRateLimit(KEY, NOW + 59 * MINUTE).blocked).toBe(false);
    recordFailure(KEY, NOW + 59 * MINUTE);
    const state = checkRateLimit(KEY, NOW + 59 * MINUTE);
    if (!state.blocked) throw new Error('unreachable');
    expect(state.waitMs).toBe(30 * MINUTE);
    expect(state.failures).toBe(9);
  });

  it('starts a fresh series after the idle reset', () => {
    failTimes(8);
    recordFailure(KEY, NOW + 2 * 60 * MINUTE);
    expect(checkRateLimit(KEY, NOW + 2 * 60 * MINUTE)).toEqual({
      blocked: false,
      attemptsLeft: 2,
    });
  });

  it('tracks players independently', () => {
    failTimes(8);
    expect(checkRateLimit('bob', NOW)).toEqual({ blocked: false, attemptsLeft: 3 });
    clearFailures('bob');
  });
});
