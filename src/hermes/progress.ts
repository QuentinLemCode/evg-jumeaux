/**
 * Cleaning up what a script wrote, before it goes in a chat.
 *
 * This file held the staged-progress machinery of spec 0015 — stage parsing,
 * an emoji checklist, approval recognition, a spec digest. Spec 0016 removed
 * every caller: the only scripts that emitted `STEP` lines were the ones the
 * bot no longer runs. Dead code that looks like a feature is worse than no
 * code, so it is gone, and only the part with a live caller remains.
 */

/**
 * Removes every terminal escape sequence (rule 7).
 *
 * The scripts stop colouring when their output is not a terminal, so this is
 * the second line of defence — for `gh`, `npm`, `agy` and anything else in the
 * stream that decides on its own. A chat message reading `ESC[36m[18:29:16]`
 * is the bot proving it does not know who it is talking to.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /[\u001b\u009b][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * A bug report, as the chat shows it (spec 0016, rules 8 and 9).
 *
 * The router's body IS the prompt. This wraps it: a headline the human reads
 * at a glance, then the prompt in a fence, which is what makes it one tap to
 * copy on a phone. Nothing here runs it or offers to.
 */
export function bugReply(body: string): string {
  const trimmed = body.trim();
  const headline = (trimmed.split('\n')[0] ?? '').trim();
  return [
    `🐛 ${headline}`,
    '',
    'À coller dans Antigravity :',
    '',
    '```',
    trimmed,
    '```',
  ].join('\n');
}
