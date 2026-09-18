import { describe, expect, it } from 'vitest';

import { Runner, since } from './jobs';

describe('Runner', () => {
  it('captures output and reports success', async () => {
    const result = await new Runner(process.cwd()).run('echo', 'node', ['-e', "console.log('bonjour')"]);
    expect(result).toEqual({ ok: true, output: 'bonjour' });
  });

  it('reports a non-zero exit as a failure, keeping the output', async () => {
    const result = await new Runner(process.cwd()).run('boom', 'node', [
      '-e',
      "console.log('avant'); process.exit(3)",
    ]);
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain('avant');
  });

  it('merges stderr into the output', async () => {
    // A failing script says why on stderr, and that is the half worth reading.
    const result = await new Runner(process.cwd()).run('err', 'node', [
      '-e',
      "console.error('ça a cassé'); process.exit(1)",
    ]);
    expect(result?.output).toContain('ça a cassé');
  });

  it('says so rather than nothing when a script is silent', async () => {
    const result = await new Runner(process.cwd()).run('quiet', 'node', ['-e', 'process.exit(0)']);
    expect(result?.output).toMatch(/aucune sortie/);
  });

  it('refuses a second job instead of queueing it', async () => {
    // Rule 10: two pipeline.sh runs would fight over one working tree, and on a
    // phone a queued answer that arrives minutes later is worse than a no.
    const runner = new Runner(process.cwd());
    const first = runner.run('long', 'node', ['-e', 'setTimeout(() => {}, 300)']);
    expect(runner.running()?.what).toBe('long');
    expect(await runner.run('second', 'node', ['-e', ''])).toBeNull();
    await first;
    // And the lock is released afterwards.
    expect(runner.running()).toBeNull();
    expect(await runner.run('third', 'node', ['-e', ''])).not.toBeNull();
  });

  it('reports a command that does not exist rather than hanging', async () => {
    const result = await new Runner(process.cwd()).run('missing', '/nope/not-a-command', []);
    expect(result?.ok).toBe(false);
    expect(result?.output).toContain('ENOENT');
  });
});

describe('since', () => {
  it('counts in seconds under a minute', () => {
    expect(since(0, 42_000)).toBe('depuis 42 s');
  });

  it('counts in minutes above one', () => {
    expect(since(0, 250_000)).toBe('depuis 4 min');
  });

  it('never reports a negative age when clocks disagree', () => {
    expect(since(1_000, 0)).toBe('depuis 0 s');
  });
});
