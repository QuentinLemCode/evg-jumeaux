import { describe, expect, it } from 'vitest';

import {
  directedAtBot,
  isAuthorised,
  parseAllowlist,
  parsePipelineReport,
  parseRouterReport,
  route,
  truncateForTelegram,
  type TgMessage,
} from './parse';

const BOT = { username: 'evg_bot', id: 999 };

function message(text: string, entities?: TgMessage['entities']): TgMessage {
  return {
    message_id: 1,
    from: { id: 42, username: 'quentin' },
    chat: { id: -100, type: 'group' },
    text,
    entities,
  };
}

/** Builds the `mention` entity Telegram would send for a given substring. */
function mention(text: string, needle = '@evg_bot') {
  return [{ type: 'mention', offset: text.indexOf(needle), length: needle.length }];
}

describe('directedAtBot', () => {
  it('ignores a message with no mention', () => {
    expect(directedAtBot(message('on joue au palet ?'), BOT)).toBeNull();
  });

  it('accepts a mention and strips it', () => {
    const text = '@evg_bot /status';
    expect(directedAtBot(message(text, mention(text)), BOT)?.text).toBe('/status');
  });

  it('accepts the mention at the end just the same', () => {
    const text = '/status @evg_bot';
    expect(directedAtBot(message(text, mention(text)), BOT)?.text).toBe('/status');
  });

  it('accepts a mention in the middle of a sentence', () => {
    const text = 'dis @evg_bot ajoute un mur de photos';
    expect(directedAtBot(message(text, mention(text)), BOT)?.text).toBe(
      'dis ajoute un mur de photos',
    );
  });

  it('refuses text that merely looks like a mention', () => {
    // The whole point of rule 2: a quoted or pasted "@evg_bot" carries no
    // entity, and must not be able to start a deploy.
    expect(directedAtBot(message('il a écrit @evg_bot hier'), BOT)).toBeNull();
  });

  it('is case-insensitive about the username', () => {
    const text = '@EVG_Bot /logs';
    expect(directedAtBot(message(text, mention(text, '@EVG_Bot')), BOT)?.text).toBe('/logs');
  });

  it('ignores a mention of somebody else', () => {
    const text = '@pablo regarde ça';
    expect(directedAtBot(message(text, mention(text, '@pablo')), BOT)).toBeNull();
  });

  it('accepts a text_mention pointing at the bot id', () => {
    // What Telegram sends when the bot has no username in that context.
    const text = 'Hermes /status';
    const entities = [{ type: 'text_mention', offset: 0, length: 6, user: { id: 999 } }];
    expect(directedAtBot(message(text, entities), BOT)?.text).toBe('/status');
  });

  it('ignores a text_mention of another user', () => {
    const text = 'Pablo /status';
    const entities = [{ type: 'text_mention', offset: 0, length: 5, user: { id: 7 } }];
    expect(directedAtBot(message(text, entities), BOT)).toBeNull();
  });

  it('strips several mentions, keeping the offsets valid', () => {
    const text = '@evg_bot fais un truc @evg_bot';
    const entities = [
      { type: 'mention', offset: 0, length: 8 },
      { type: 'mention', offset: 22, length: 8 },
    ];
    expect(directedAtBot(message(text, entities), BOT)?.text).toBe('fais un truc');
  });

  it('gets the offsets right after an emoji', () => {
    // Telegram counts UTF-16 code units, and 🎉 is two of them. Converting to
    // code points here would shift every later offset by one.
    const text = '🎉 @evg_bot /status';
    const entities = [{ type: 'mention', offset: 3, length: 8 }];
    expect(directedAtBot(message(text, entities), BOT)?.text).toBe('🎉 /status');
  });

  it('carries a label for the refusal log', () => {
    const text = '@evg_bot /deploy';
    expect(directedAtBot(message(text, mention(text)), BOT)?.fromLabel).toBe('@quentin (42)');
  });

  it('ignores a message with no text at all', () => {
    expect(directedAtBot({ message_id: 1, chat: { id: 1, type: 'group' } }, BOT)).toBeNull();
  });
});

describe('isAuthorised', () => {
  it('accepts a listed id', () => {
    expect(isAuthorised(42, [7, 42])).toBe(true);
  });

  it('refuses an unlisted id', () => {
    expect(isAuthorised(1, [7, 42])).toBe(false);
  });

  it('refuses EVERYONE when the list is empty', () => {
    // Rule 7. The opposite reading turns a forgotten variable into an open door
    // that can deploy production from a group chat.
    expect(isAuthorised(42, [])).toBe(false);
  });
});

describe('parseAllowlist', () => {
  it('reads a comma-separated list', () => {
    expect(parseAllowlist('42, 7 ,123')).toEqual([42, 7, 123]);
  });

  it('is empty for undefined or blank', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist('  ')).toEqual([]);
  });

  it('drops anything that is not a number rather than guessing', () => {
    expect(parseAllowlist('42,@quentin,,7')).toEqual([42, 7]);
  });
});

describe('route', () => {
  it('treats a bare mention as help', () => {
    expect(route('')).toEqual({ kind: 'command', command: 'help' });
  });

  it('maps the commands that remain', () => {
    for (const [text, command] of [
      ['/status', 'status'],
      ['/errors', 'errors'],
      ['/logs', 'logs'],
      ['/help', 'help'],
      ['/reset', 'reset'],
    ] as const) {
      expect(route(text)).toEqual({ kind: 'command', command });
    }
  });

  it('no longer knows /deploy (spec 0016, rule 2)', () => {
    // Deploying is a write, and the bot is read-only. It must land in the
    // unknown-command branch, which lists what does exist.
    expect(route('/deploy')).toEqual({ kind: 'unknown-command', typed: '/deploy' });
    expect(route('/deploy@evg_bot')).toEqual({
      kind: 'unknown-command',
      typed: '/deploy@evg_bot',
    });
  });

  it('accepts the @bot suffix Telegram adds in groups', () => {
    expect(route('/status@evg_bot')).toEqual({ kind: 'command', command: 'status' });
  });

  it('reports an unknown command instead of doing anything', () => {
    expect(route('/destroy')).toEqual({ kind: 'unknown-command', typed: '/destroy' });
  });

  it('treats free text as something for the router to decide', () => {
    expect(route('ajoute un mur de photos')).toEqual({
      kind: 'request',
      request: 'ajoute un mur de photos',
    });
  });
});

describe('truncateForTelegram', () => {
  it('leaves a short message alone', () => {
    expect(truncateForTelegram('court')).toBe('court');
  });

  it('keeps the END of a long one', () => {
    const text = Array.from({ length: 500 }, (_, i) => `ligne ${i}`).join('\n');
    const out = truncateForTelegram(text, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain('ligne 499');
    expect(out).not.toContain('ligne 0\n');
  });

  it('starts at a line boundary rather than mid-word', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd';
    const out = truncateForTelegram(text, 14);
    expect(out.startsWith('[…]\n')).toBe(true);
    expect(out.slice(4).split('\n')[0]).toMatch(/^(bbbb|cccc|dddd)$/);
  });
});

describe('parseRouterReport', () => {
  const report = (decision: string, body: string) => `DECISION: ${decision}\n---\n${body}`;

  it('accepts a report with NO separator, because the model often omits it', () => {
    // Observed: the router answered `DECISION: change` followed straight by
    // the request, and the bot replied «je n'ai pas réussi à interpréter ta
    // demande» to a decision it had in fact made, and got right.
    const output = [
      '[18:29:16] running the route agent',
      'DECISION: bug',
      'le classement colle au bord sur iPhone SE',
    ].join('\n');
    expect(parseRouterReport(output)).toEqual({
      decision: 'bug',
      body: 'le classement colle au bord sur iPhone SE',
    });
  });

  it('keeps a multi-line body when the separator is missing', () => {
    expect(parseRouterReport('DECISION: answer\nDix points.\nVoir scoring.ts.')?.body).toBe(
      'Dix points.\nVoir scoring.ts.',
    );
  });

  it('still refuses a decision with nothing after it', () => {
    expect(parseRouterReport('DECISION: bug')).toBeNull();
    expect(parseRouterReport('DECISION: bug\n---\n   ')).toBeNull();
  });

  it('reads the three decisions', () => {
    expect(parseRouterReport(report('answer', 'Dix points.'))).toEqual({
      decision: 'answer',
      body: 'Dix points.',
    });
    expect(parseRouterReport(report('bug', 'les marges du classement collent au bord'))).toEqual({
      decision: 'bug',
      body: 'les marges du classement collent au bord',
    });
    expect(parseRouterReport(report('unclear', 'Quel écran ?'))).toEqual({
      decision: 'unclear',
      body: 'Quel écran ?',
    });
  });

  it('finds the decision inside the runtime noise around it', () => {
    // run_agent merges the agent's stderr into stdout, so the report never
    // arrives alone.
    const output = [
      '[14:02:11] running route agent via opencode',
      'some progress line',
      'DECISION: answer',
      '---',
      'Les points viennent de scoring.ts (spec 0005).',
    ].join('\n');
    expect(parseRouterReport(output)?.decision).toBe('answer');
    expect(parseRouterReport(output)?.body).toContain('scoring.ts');
  });

  it('keeps a multi-line answer whole', () => {
    const body = 'Première ligne.\n\nTroisième ligne.';
    expect(parseRouterReport(report('answer', body))?.body).toBe(body);
  });

  it('takes the LAST decision, not a rehearsal of the format', () => {
    // A model that explains the shape before using it must not have its
    // explanation mistaken for its verdict.
    const output = [
      'I will reply with DECISION: change',
      'if it asks for a change. Here goes.',
      'DECISION: answer',
      '---',
      'Le score vient de scoring.ts.',
    ].join('\n');
    expect(parseRouterReport(output)?.decision).toBe('answer');
  });

  it('is case-insensitive about the decision', () => {
    expect(parseRouterReport('decision: ANSWER\n---\nbonjour')?.decision).toBe('answer');
  });

  it('refuses a report with no decision', () => {
    expect(parseRouterReport('je pense que oui\n---\nvoilà')).toBeNull();
  });

  it('refuses an unknown decision rather than guessing', () => {
    // Rule 12: an unparseable report runs nothing at all.
    expect(parseRouterReport('DECISION: maybe\n---\nbonjour')).toBeNull();
  });

  it('no longer refuses a report with no separator (spec 0015)', () => {
    // This used to expect null. It cost a real request: the router answered
    // correctly, the bot said it had not understood, and nothing ran.
    expect(parseRouterReport('DECISION: answer\nLes points viennent de là')).toEqual({
      decision: 'answer',
      body: 'Les points viennent de là',
    });
  });

  it('refuses an empty body', () => {
    expect(parseRouterReport('DECISION: answer\n---\n   \n')).toBeNull();
    expect(parseRouterReport('DECISION: change\n---\n')).toBeNull();
  });

  it('ignores a separator that precedes the decision', () => {
    expect(parseRouterReport('---\nDECISION: answer')).toBeNull();
  });
});

describe('parsePipelineReport', () => {
  it('reads a successful run', () => {
    const output = [
      '[16:29:30] STEP 0/4 — starting from origin/main',
      '',
      'PIPELINE: ok',
      'STAGE: pr',
      'PR: https://github.com/x/y/pull/42',
    ].join('\n');
    expect(parsePipelineReport(output)).toEqual({
      status: 'ok',
      reason: null,
      pr: 'https://github.com/x/y/pull/42',
      spec: null,
    });
  });

  it('reads a blocked run and keeps the reason verbatim', () => {
    // Rule 7: the bot posts what the agent said, never a reason of its own.
    const output = [
      'PIPELINE: needs-human',
      'STAGE: spec',
      'SPEC_FILE: none',
      'REASON: the spec agent produced no report at all (exit 1)',
    ].join('\n');
    const outcome = parsePipelineReport(output);
    expect(outcome?.status).toBe('needs-human');
    expect(outcome?.reason).toBe('the spec agent produced no report at all (exit 1)');
  });

  it('reads the specification a spec-only run produced', () => {
    const output = [
      'STEP 2/2 — specification',
      '',
      'PIPELINE: spec-ready',
      'STAGE: spec',
      'SPEC_FILE: specs/0042-photo-wall.md',
      'BRANCH: agent/0042-photo-wall',
    ].join('\n');
    const outcome = parsePipelineReport(output);
    expect(outcome?.status).toBe('spec-ready');
    expect(outcome?.spec).toBe('specs/0042-photo-wall.md');
    expect(outcome?.pr).toBeNull();
  });

  it('reports no specification rather than the literal "none"', () => {
    const output = 'PIPELINE: needs-human\nSPEC_FILE: none';
    expect(parsePipelineReport(output)?.spec).toBeNull();
  });

  it('takes the LAST report when stages printed their own', () => {
    const output = ['PIPELINE: ok', 'REASON: none', 'PIPELINE: needs-human', 'REASON: la vraie'].join(
      '\n',
    );
    expect(parsePipelineReport(output)).toMatchObject({ status: 'needs-human', reason: 'la vraie' });
  });

  it('treats "none" as absent rather than as a value', () => {
    expect(parsePipelineReport('PIPELINE: ok\nREASON: none\nPR: none')).toEqual({
      status: 'ok',
      reason: null,
      pr: null,
      spec: null,
    });
  });

  it('returns null when there is no report to read', () => {
    expect(parsePipelineReport('tee: permission denied\n')).toBeNull();
  });
});

describe('the decisions that are gone', () => {
  it('reads `bug` like the others', () => {
    expect(parseRouterReport('DECISION: bug\n---\nle service ne démarre pas')).toEqual({
      decision: 'bug',
      body: 'le service ne démarre pas',
    });
  });

  it('refuses `change` and `fix` outright (spec 0016, rule 4)', () => {
    // They used to start the pipeline and fix.sh. Accepting them now would be
    // worse than refusing: the gateway has nothing to run, so the reply would
    // read as a promise it cannot keep.
    expect(parseRouterReport('DECISION: change\n---\najoute un mur de photos')).toBeNull();
    expect(parseRouterReport('DECISION: fix\n---\nle service ne démarre pas')).toBeNull();
  });

  it('is still refused when the body is empty', () => {
    expect(parseRouterReport('DECISION: bug\n---\n  ')).toBeNull();
  });

  it('does not match a word that merely contains a decision', () => {
    expect(parseRouterReport('DECISION: debug\n---\nnon')).toBeNull();
  });
});
