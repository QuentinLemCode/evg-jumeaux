/**
 * Grouping and describing client-side failures (spec 0011).
 *
 * Pure on purpose: the fingerprint decides whether a report is a new bug or
 * the same one again, and getting that wrong either floods the table or hides
 * a real regression. It is worth unit tests, and unit tests need it free of
 * I/O.
 */
import { createHash } from 'node:crypto';

export const CLIENT_ERROR_KINDS = ['render', 'unhandled', 'rejection', 'sw'] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** Rejected, not truncated: a silently cut stack is a stack you cannot trust. */
export const CLIENT_ERROR_LIMITS = {
  message: 500,
  stack: 8000,
  path: 300,
  userAgent: 300,
  viewport: 20,
} as const;

export type ClientErrorReport = {
  kind: ClientErrorKind;
  message: string;
  stack?: string | null;
  path: string;
  appCommit?: string | null;
  viewport?: string | null;
};

/**
 * Strips the parts of a message that change between two occurrences of the
 * SAME bug: ids, hashes, numbers, timestamps. Without this, "match 3f2a… not
 * found" is a new group every single time.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    .replace(/\b[0-9a-f]{16,}\b/gi, 'HASH')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'TS')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first few frames, with line and column numbers removed.
 *
 * Only the first three: deeper frames are framework internals that shift with
 * every Next.js patch, and including them would split one bug into a new group
 * after each upgrade.
 */
export function stackSignature(stack: string | null | undefined, frames = 3): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') || /\.(js|ts|tsx|mjs):\d+/.test(line))
    .slice(0, frames)
    .map((line) =>
      line
        // page-4f2c8a.js becomes page.js: the chunk hash changes on every
        // build, and the same bug must not look new after a deploy.
        .replace(/-[0-9a-f]{6,}\.(js|mjs)/gi, '.$1')
        .replace(/:\d+:\d+/g, '')
        .replace(/\?[^\s)]*/g, ''),
    )
    .join(' | ');
}

export function fingerprintError(report: ClientErrorReport): string {
  const parts = [report.kind, normaliseMessage(report.message), stackSignature(report.stack)];
  return createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 20);
}

/**
 * A raw User-Agent is unreadable in a list of thirty rows, and "which browser"
 * is one of the three things actually asked for. So keep the raw string for
 * fidelity and show this.
 */
export function summariseBrowser(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Navigateur inconnu';
  const ua = userAgent;

  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;

  // Order matters: every Chromium browser also claims "Safari", and Edge also
  // claims "Chrome". Most specific first.
  const browsers: [RegExp, string][] = [
    [/\bEdg\/(\d+)/, 'Edge'],
    [/\bOPR\/(\d+)/, 'Opera'],
    [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/\bFxiOS\/(\d+)/, 'Firefox'],
    [/\bCriOS\/(\d+)/, 'Chrome'],
    [/\bFirefox\/(\d+)/, 'Firefox'],
    [/\bChrome\/(\d+)/, 'Chrome'],
    [/\bVersion\/(\d+).*\bSafari\//, 'Safari'],
  ];

  for (const [pattern, name] of browsers) {
    const match = pattern.exec(ua);
    if (match) {
      const version = match[1];
      return platform ? `${name} ${version} - ${platform}` : `${name} ${version}`;
    }
  }
  return platform ? `Navigateur inconnu - ${platform}` : 'Navigateur inconnu';
}

export type ValidationFailure = { field: string; reason: string };

/** Size checks, run before anything touches the database. */
export function validateReport(report: ClientErrorReport): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  if (!CLIENT_ERROR_KINDS.includes(report.kind)) {
    failures.push({ field: 'kind', reason: 'unknown kind' });
  }
  if (report.message.trim().length === 0) {
    failures.push({ field: 'message', reason: 'empty' });
  }
  const sized: [string, string | null | undefined, number][] = [
    ['message', report.message, CLIENT_ERROR_LIMITS.message],
    ['stack', report.stack, CLIENT_ERROR_LIMITS.stack],
    ['path', report.path, CLIENT_ERROR_LIMITS.path],
    ['viewport', report.viewport, CLIENT_ERROR_LIMITS.viewport],
  ];
  for (const [field, value, limit] of sized) {
    if (typeof value === 'string' && value.length > limit) {
      failures.push({ field, reason: `over ${limit} characters` });
    }
  }
  if (!report.path.startsWith('/')) {
    failures.push({ field: 'path', reason: 'must be a route, not a full URL' });
  }
  return failures;
}
