import { describe, expect, it } from 'vitest';

import { bugReply, stripAnsi } from './progress';

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

describe('bugReply', () => {
  const prompt = [
    'Le classement colle au bord sur iPhone SE',
    '',
    'Écran / endpoint : /leaderboard',
    'Symptôme : les cartes touchent le bord gauche en 375px',
    'Attendu : non précisé',
    'Spec concernée : specs/0010-confetti.md',
  ].join('\n');

  it('leads with the first line and fences the whole prompt', () => {
    const reply = bugReply(prompt);
    expect(reply.split('\n')[0]).toBe('🐛 Le classement colle au bord sur iPhone SE');
    expect(reply).toContain('À coller dans Antigravity :');
    // The prompt survives whole, including the lines a coding agent needs.
    expect(reply).toContain('Écran / endpoint : /leaderboard');
    expect(reply).toContain('Spec concernée : specs/0010-confetti.md');
  });

  it('opens and closes exactly one fence', () => {
    expect(bugReply(prompt).match(/```/g)).toHaveLength(2);
  });

  it('offers nothing that runs it (rule 9)', () => {
    const reply = bugReply(prompt).toLowerCase();
    for (const word of ['pipeline', 'je lance', 'valide', 'réponds « oui »']) {
      expect(reply).not.toContain(word);
    }
  });

  it('survives a one-line prompt and a padded one', () => {
    expect(bugReply('ça plante').split('\n')[0]).toBe('🐛 ça plante');
    expect(bugReply('\n\n  ça plante  \n\n').split('\n')[0]).toBe('🐛 ça plante');
  });
});
