import { describe, expect, it } from 'vitest';

import { countdown, relativeTime, signedPoints, waitLabel } from './format';

const NOW = 1_700_000_000_000;

describe('relativeTime', () => {
  it('collapses anything under a minute', () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe('à l’instant');
  });

  it('shows minutes within the hour', () => {
    expect(relativeTime(NOW - 12 * 60_000, NOW)).toBe('il y a 12 min');
  });

  it('shows hours within the day', () => {
    expect(relativeTime(NOW - 5 * 3_600_000, NOW)).toBe('il y a 5 h');
  });

  it('says hier for one day', () => {
    expect(relativeTime(NOW - 26 * 3_600_000, NOW)).toBe('hier');
  });

  it('never shows a negative delta', () => {
    expect(relativeTime(NOW + 10_000, NOW)).toBe('à l’instant');
  });
});

describe('countdown', () => {
  it('formats minutes and seconds', () => {
    expect(countdown(5 * 60_000)).toBe('05:00');
    expect(countdown(65_000)).toBe('01:05');
  });

  it('floors at zero', () => {
    expect(countdown(-1)).toBe('00:00');
  });
});

describe('waitLabel', () => {
  it('uses seconds below a minute', () => {
    expect(waitLabel(10_000)).toBe('10 secondes');
    expect(waitLabel(1_000)).toBe('1 seconde');
  });

  it('rounds up, so it never promises a wait that is already over', () => {
    expect(waitLabel(9_400)).toBe('10 secondes');
    expect(waitLabel(61_000)).toBe('2 minutes');
  });

  it('uses minutes from a minute up', () => {
    expect(waitLabel(60_000)).toBe('1 minute');
    expect(waitLabel(1_800_000)).toBe('30 minutes');
  });

  it('never says zero', () => {
    expect(waitLabel(0)).toBe('1 seconde');
  });
});

describe('signedPoints', () => {
  it('prefixes a plus on gains', () => {
    expect(signedPoints(21)).toBe('+21');
  });

  it('keeps the minus on reversals', () => {
    expect(signedPoints(-21)).toBe('-21');
  });
});
