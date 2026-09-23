import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The read-only door (spec 0016), asserted against the files themselves.
 *
 * This is a structural test and not a behavioural one, deliberately. The
 * property that matters — "no message can start something that writes" — is a
 * property of what the gateway CAN reach, and the cheapest honest way to check
 * it is to look. A behavioural test would have to spawn the scripts it is
 * trying to prove unreachable.
 *
 * The failure it guards against is a regression by convenience: someone adds
 * one `pipeline.sh` call back "just for this case", and nothing else in the
 * suite notices.
 */
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/** Every script in `scripts/agent/` that writes something. */
const WRITERS = [
  'pipeline.sh',
  'spec.sh',
  'code.sh',
  'open-pr.sh',
  'fix.sh',
  'review.sh',
  'deploy.sh',
];

describe('the gateway reaches nothing that writes (rule 1)', () => {
  const gateway = read('src/hermes/gateway.ts');

  it.each(WRITERS)('never mentions %s', (script) => {
    // A comment saying it USED to call fix.sh would fail this, which is the
    // right trade: the test is about what the file can reach, and prose next
    // to a path is how a path comes back.
    expect(gateway).not.toContain(script);
  });

  it('runs only the three read-only scripts', () => {
    const called = [...gateway.matchAll(/\$\{AGENT\}\/([a-z-]+\.sh)/g)].map((m) => m[1]);
    expect(new Set(called)).toEqual(new Set(['status.sh', 'app-exec.sh', 'route.sh']));
  });

  it('has no /deploy command (rule 2)', () => {
    expect(read('src/hermes/parse.ts')).not.toContain("'/deploy'");
  });
});

describe('the door between the two machines is read-only (rule 3)', () => {
  const appExec = read('scripts/agent/app-exec.sh');

  it('refuses deploy and rollback in one branch', () => {
    expect(appExec).toMatch(/^\s*deploy\|rollback\)/m);
    expect(appExec).toContain('was removed: this door is read-only');
  });

  it('runs deploy.sh only with --status', () => {
    // Two corrections live in this test. It first asserted the STRING
    // `deploy.sh --tag` was absent, and failed on the refusal message that
    // deliberately tells a human the real command. It then asserted deploy.sh
    // was never executed, and failed on `deploy.sh --status` — which is
    // genuinely read-only: it echoes the colour, the image, the commit, a
    // health curl and `compose ps`, then exits before any write path.
    //
    // So the property is narrower and truer: what is executed may reach
    // deploy.sh, but only through its reading flag.
    const executed = [...appExec.matchAll(/run_there\s+["'](.+?)["']/g)].map((m) => m[1] ?? '');
    expect(executed.length).toBeGreaterThan(0);
    for (const command of executed) {
      if (!command.includes('deploy.sh')) continue;
      expect(command).toContain('deploy.sh --status');
      expect(command).not.toMatch(/--(tag|rollback|commit)/);
    }
  });

  it('keeps the read verbs', () => {
    for (const verb of ['status', 'logs', 'ps', 'health', 'client-errors', 'data']) {
      expect(appExec).toMatch(new RegExp(`^\\s*${verb}\\)`, 'm'));
    }
  });
});

describe('the snapshot cannot carry a secret (rule 11)', () => {
  // The snapshot lists its columns one by one. These are the only secret
  // columns in the schema, and the assertion is against the SQL rather than
  // against a sample of output: an empty table would make a sampled test pass
  // while the query happily selected a hash.
  const block = read('scripts/agent/app-exec.sh').split('  data)')[1]?.split('  *)')[0] ?? '';
  // Comments stripped: they explain precisely which columns are excluded and
  // why `SELECT *` is not used, so asserting against them fails on the
  // explanation of the rule it is checking.
  const snapshot = block
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

  it('was found in the file at all', () => {
    // Guards the splits above: a renamed verb would silently make every
    // assertion below vacuous.
    expect(snapshot).toContain('sqlite3 -readonly -json');
    expect(snapshot).toContain('FROM users');
  });

  it.each(['pin_hash', 'p256dh', 'push_subscriptions', 'endpoint'])(
    'never selects %s',
    (column) => {
      expect(snapshot).not.toContain(column);
    },
  );

  it('never uses SELECT *', () => {
    // `SELECT *` would ship whichever secret a later migration adds to a table
    // that has none today.
    expect(snapshot).not.toMatch(/SELECT\s+\*/i);
  });

  it('opens the database read-only', () => {
    const reads = [...snapshot.matchAll(/sqlite3\s+(\S+)/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    for (const flag of reads) expect(flag).toBe('-readonly');
  });
});

describe('the watcher proposes text, not a pull request (rule 15)', () => {
  const watcher = read('scripts/agent/watch-errors.sh');

  it('no longer calls fix.sh', () => {
    const calls = [...watcher.matchAll(/scripts\/agent\/(\w[\w-]*\.sh)/g)].map((m) => m[1]);
    expect(calls).not.toContain('fix.sh');
  });

  it('emits a prompt instead', () => {
    expect(watcher).toContain('emit_prompt');
    expect(watcher).toContain('À coller dans Antigravity');
  });
});
