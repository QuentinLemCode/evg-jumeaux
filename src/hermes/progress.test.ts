import { describe, expect, it } from 'vitest';

import {
  isApproval,
  parseStages,
  readSpecDigest,
  renderStages,
  stripAnsi,
} from './progress';

/** What `lib.sh` used to emit unconditionally, and still emits on a terminal. */
const ESC = '\u001b';
const coloured = (text: string) => `${ESC}[36m[18:29:16]${ESC}[0m ${text}`;

describe('stripAnsi', () => {
  it('removes the colour the scripts emit on a terminal', () => {
    expect(stripAnsi(coloured('running the spec agent'))).toBe('[18:29:16] running the spec agent');
  });

  it('leaves text with no escapes exactly as it is', () => {
    expect(stripAnsi('STEP 2/5 — specification')).toBe('STEP 2/5 — specification');
  });

  it('removes the 8-bit CSI form too', () => {
    expect(stripAnsi('\u009b31mrouge\u009b0m')).toBe('rouge');
  });

  it('survives an empty string and a lone escape', () => {
    expect(stripAnsi('')).toBe('');
    expect(stripAnsi(ESC)).toBe(ESC);
  });
});

describe('parseStages', () => {
  it('reads every STEP line, in order, whatever order they arrived in', () => {
    const output = ['STEP 2/5 — specification', 'noise', 'STEP 1/5 — preparation'].join('\n');
    expect(parseStages(output)).toEqual([
      { n: 1, total: 5, label: 'preparation' },
      { n: 2, total: 5, label: 'specification' },
    ]);
  });

  it('reads a STEP line that is coloured', () => {
    expect(parseStages(coloured('STEP 3/5 — implementation'))).toEqual([
      { n: 3, total: 5, label: 'implementation' },
    ]);
  });

  it('counts a stage announced twice once', () => {
    const output = 'STEP 2/5 — specification\nSTEP 2/5 — specification';
    expect(parseStages(output)).toHaveLength(1);
  });

  it('returns nothing rather than throwing when there is no STEP line', () => {
    expect(parseStages('npm ci\nsome agent chatter')).toEqual([]);
    expect(parseStages('')).toEqual([]);
  });

  it('ignores a malformed STEP line', () => {
    expect(parseStages('STEP 0/0 — nothing')).toEqual([]);
  });
});

describe('renderStages', () => {
  it('ticks what is done, marks what is running, leaves the rest blank', () => {
    const output = 'STEP 1/5 — preparation\nSTEP 2/5 — specification';
    expect(renderStages(output)).toBe(
      ['✅ Préparation', '⏳ Spécification', '⬜ étape 3', '⬜ étape 4', '⬜ étape 5'].join('\n'),
    );
  });

  it('marks the last stage done when the run succeeded', () => {
    const output = 'STEP 1/2 — preparation\nSTEP 2/2 — specification';
    expect(renderStages(output, { finished: true, ok: true })).toBe(
      ['✅ Préparation', '✅ Spécification'].join('\n'),
    );
  });

  it('marks the last stage failed, and keeps it on screen', () => {
    const output = 'STEP 1/2 — preparation\nSTEP 2/2 — specification';
    expect(renderStages(output, { finished: true, ok: false })).toBe(
      ['✅ Préparation', '❌ Spécification'].join('\n'),
    );
  });

  it('shows an unknown label as the script wrote it', () => {
    expect(renderStages('STEP 1/1 — something new')).toBe('⏳ something new');
  });

  it('is empty when nothing has been announced, so the caller can fall back', () => {
    expect(renderStages('no stages here')).toBe('');
  });

  it('never leaks an escape sequence', () => {
    expect(renderStages(coloured('STEP 1/2 — preparation'))).not.toContain(ESC);
  });
});

describe('isApproval', () => {
  it.each([
    'oui',
    'Oui',
    'OUI !',
    'ok',
    'OK !',
    'ok...',
    'go',
    'c’est bon',
    "c'est bon.",
    'valide',
    'validé',
    'vas-y',
    'd’accord',
    '👍',
    '  ok  ',
  ])('accepts %j', (text) => {
    expect(isApproval(text)).toBe(true);
  });

  it.each([
    'oui mais ajoute un bouton',
    'okay donc on fait quoi',
    'non',
    'pas encore',
    'ok pour la spec mais change le titre',
    '',
    '   ',
    'lance le déploiement en prod',
  ])('refuses %j', (text) => {
    expect(isApproval(text)).toBe(false);
  });
});

describe('readSpecDigest', () => {
  const spec = [
    '# 0042 — A photo wall',
    '',
    '| | |',
    '|---|---|',
    '| Status | Draft |',
    '',
    '## Intent',
    '',
    'Guests want to post pictures',
    'and see everyone else’s.',
    '',
    'A second paragraph nobody needs in a chat.',
    '',
    '## Behaviour',
    '',
    'Something long.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] A guest can post a picture',
    '- [x] The wall is visible to everyone',
    '      even the ones who arrived late',
    '- not a criterion',
    '',
    '## Changelog',
    '',
    '- created',
  ].join('\n');

  it('reads the title, the first paragraph of the intent, and the criteria', () => {
    expect(readSpecDigest(spec)).toEqual({
      title: '0042 — A photo wall',
      intent: 'Guests want to post pictures and see everyone else’s.',
      criteria: [
        'A guest can post a picture',
        'The wall is visible to everyone even the ones who arrived late',
      ],
    });
  });

  it('stops the criteria at the next heading', () => {
    expect(readSpecDigest(spec).criteria).not.toContain('created');
  });

  it('returns nulls and an empty list rather than throwing on a spec it cannot read', () => {
    expect(readSpecDigest('')).toEqual({ title: null, intent: null, criteria: [] });
    expect(readSpecDigest('just some prose')).toEqual({
      title: null,
      intent: null,
      criteria: [],
    });
  });
});
