import { describe, expect, it } from 'vitest';

import {
  fingerprintError,
  normaliseMessage,
  stackSignature,
  summariseBrowser,
  validateReport,
  type ClientErrorReport,
} from './client-errors';

function report(overrides: Partial<ClientErrorReport> = {}): ClientErrorReport {
  return {
    kind: 'render',
    message: 'Cannot read properties of undefined (reading name)',
    stack: `TypeError: Cannot read properties of undefined
    at StandingRow (page-4f2c8a.js:1:2840)
    at renderWithHooks (react-dom-9ab21c.js:1:18420)
    at updateFunctionComponent (react-dom-9ab21c.js:1:22100)
    at beginWork (react-dom-9ab21c.js:1:30500)`,
    path: '/leaderboard',
    appCommit: 'a1b2c3d',
    viewport: '390x844',
    ...overrides,
  };
}

describe('normaliseMessage', () => {
  it('collapses ids, hashes, numbers and timestamps', () => {
    expect(
      normaliseMessage('match 3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708 not found after 42 tries'),
    ).toBe('match UUID not found after N tries');
    expect(normaliseMessage('bad digest deadbeefdeadbeefdead')).toBe('bad digest HASH');
    expect(normaliseMessage('expired at 2026-09-17T10:20:30.123Z')).toBe('expired at TS');
  });

  it('squashes whitespace so wrapping does not change the group', () => {
    expect(normaliseMessage('a   b\n  c')).toBe('a b c');
  });
});

describe('stackSignature', () => {
  it('keeps only the first three frames', () => {
    const signature = stackSignature(report().stack);
    expect(signature).toContain('StandingRow');
    // beginWork is the fourth frame: framework internals shift with every
    // Next.js patch, and including them would split one bug per upgrade.
    expect(signature).not.toContain('beginWork');
  });

  it('drops the chunk hash, so a deploy does not create a new group', () => {
    const before = stackSignature('    at StandingRow (page-4f2c8a.js:1:2840)');
    const after = stackSignature('    at StandingRow (page-99ffee.js:1:2840)');
    expect(before).toBe(after);
  });

  it('drops line and column numbers', () => {
    expect(stackSignature('    at foo (page.js:12:34)')).toBe('at foo (page.js)');
  });

  it('is empty for a missing stack', () => {
    expect(stackSignature(null)).toBe('');
    expect(stackSignature(undefined)).toBe('');
  });
});

describe('fingerprintError', () => {
  it('groups two occurrences of the same failure', () => {
    expect(fingerprintError(report())).toBe(fingerprintError(report()));
  });

  it('groups the same failure with a different id in the message', () => {
    const a = report({ message: 'match aaaaaaaa-1111-2222-3333-444444444444 not found' });
    const b = report({ message: 'match bbbbbbbb-1111-2222-3333-444444444444 not found' });
    expect(fingerprintError(a)).toBe(fingerprintError(b));
  });

  it('groups the same failure across a rebuild', () => {
    const before = report();
    const after = report({ stack: report().stack?.replace(/4f2c8a/g, '77aa11') });
    expect(fingerprintError(before)).toBe(fingerprintError(after));
  });

  it('separates two different failures', () => {
    expect(fingerprintError(report())).not.toBe(
      fingerprintError(report({ message: 'Failed to fetch' })),
    );
  });

  it('separates the same message raised in a different place', () => {
    expect(fingerprintError(report())).not.toBe(
      fingerprintError(report({ stack: '    at MatchActions (page.js:1:10)' })),
    );
  });

  it('separates the same message with a different kind', () => {
    expect(fingerprintError(report())).not.toBe(
      fingerprintError(report({ kind: 'rejection' })),
    );
  });

  it('is short enough to read in a list', () => {
    expect(fingerprintError(report())).toMatch(/^[0-9a-f]{20}$/);
  });
});

describe('summariseBrowser', () => {
  const cases: [string, string][] = [
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      'Safari 18 - iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      'Chrome 131 - Android',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge 130 - macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Firefox 133 - Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome 130 - iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      'Samsung Internet 23 - Android',
    ],
  ];

  it.each(cases)('reads %s as %s', (userAgent, expected) => {
    expect(summariseBrowser(userAgent)).toBe(expected);
  });

  it('does not mistake Chrome for Safari, nor Edge for Chrome', () => {
    // Every Chromium browser also claims "Safari", and Edge also claims
    // "Chrome". Getting this order wrong makes the column useless.
    expect(summariseBrowser(cases[1]![0])).toContain('Chrome');
    expect(summariseBrowser(cases[2]![0])).toContain('Edge');
  });

  it('degrades rather than guessing', () => {
    expect(summariseBrowser(null)).toBe('Navigateur inconnu');
    expect(summariseBrowser('')).toBe('Navigateur inconnu');
    expect(summariseBrowser('curl/8.4.0')).toBe('Navigateur inconnu');
    expect(summariseBrowser('Mozilla/5.0 (iPhone) SomethingNew/1.0')).toBe(
      'Navigateur inconnu - iPhone',
    );
  });
});

describe('validateReport', () => {
  it('accepts a normal report', () => {
    expect(validateReport(report())).toEqual([]);
  });

  it('rejects an over-long stack rather than truncating it', () => {
    const failures = validateReport(report({ stack: 'x'.repeat(8001) }));
    expect(failures.map((f) => f.field)).toContain('stack');
  });

  it('rejects an over-long message', () => {
    expect(validateReport(report({ message: 'x'.repeat(501) })).map((f) => f.field)).toContain(
      'message',
    );
  });

  it('rejects an empty message', () => {
    expect(validateReport(report({ message: '   ' })).map((f) => f.field)).toContain('message');
  });

  it('rejects a full URL where a route belongs', () => {
    // A query string can carry a `next=` destination; there is no reason to
    // store more than the route (spec 0011, data model).
    expect(
      validateReport(report({ path: 'https://evg.example.com/leaderboard?next=/x' })).map(
        (f) => f.field,
      ),
    ).toContain('path');
  });

  it('rejects an unknown kind', () => {
    expect(
      validateReport(report({ kind: 'explosion' as never })).map((f) => f.field),
    ).toContain('kind');
  });

  it('accepts a report with no stack at all', () => {
    expect(validateReport(report({ stack: null }))).toEqual([]);
  });
});
