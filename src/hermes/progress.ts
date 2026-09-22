/**
 * What the chat is shown while a run is happening (spec 0015).
 *
 * Pure, like `parse.ts`, and separate from it because it answers a different
 * question: `parse.ts` decides what a message asked for, this decides what the
 * human watching their phone gets to see.
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

/** One `STEP n/total — label` line from a script (rule 4). */
export type Stage = { n: number; total: number; label: string };

/**
 * The stages a run has announced so far.
 *
 * This single line is the whole contract between the shell scripts and the
 * chat. Everything else in the stream is an agent talking to itself.
 */
export function parseStages(output: string): Stage[] {
  const stages: Stage[] = [];
  for (const line of stripAnsi(output).split('\n')) {
    const match = /STEP\s+(\d+)\s*\/\s*(\d+)\s*[—–-]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const n = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(n) || !Number.isFinite(total) || total < 1 || n < 1) continue;
    const stage: Stage = { n, total, label: match[3] ?? '' };
    // A stage announced twice (a retry) is still one stage.
    const already = stages.findIndex((seen) => seen.n === n);
    if (already === -1) stages.push(stage);
    else stages[already] = stage;
  }
  return stages.sort((a, b) => a.n - b.n);
}

/** The scripts log in English like everything else; the chat is French. */
const STAGE_FR: Record<string, string> = {
  preparation: 'Préparation',
  specification: 'Spécification',
  implementation: 'Implémentation',
  review: 'Relecture',
  'pull request': 'Pull request',
  diagnosis: 'Diagnostic',
  repair: 'Réparation',
};

/**
 * The progress list the human reads (rules 5 and 6).
 *
 * `finished` says the run is over, so the last announced stage is no longer
 * running: it either succeeded or is the one that failed. A stage is never
 * dropped once shown — where it stopped is the most useful thing on screen.
 */
export function renderStages(
  output: string,
  state: { finished?: boolean; ok?: boolean } = {},
): string {
  const stages = parseStages(output);
  if (stages.length === 0) return '';

  const total = Math.max(...stages.map((stage) => Math.max(stage.total, stage.n)));
  const current = Math.max(...stages.map((stage) => stage.n));
  const byNumber = new Map(stages.map((stage) => [stage.n, stage]));

  const lines: string[] = [];
  for (let n = 1; n <= total; n += 1) {
    const stage = byNumber.get(n);
    const label = stage ? (STAGE_FR[stage.label.toLowerCase()] ?? stage.label) : `étape ${n}`;
    let mark: string;
    if (n < current) mark = '✅';
    else if (n > current) mark = '⬜';
    else if (state.finished !== true) mark = '⏳';
    else mark = state.ok === true ? '✅' : '❌';
    lines.push(`${mark} ${label}`);
  }
  return lines.join('\n');
}

/**
 * Is this reply an approval and nothing else? (rules 9 and 12)
 *
 * Whole-string membership, deliberately: «oui mais ajoute un bouton» is a
 * revision, not a yes, and treating it as one would write code nobody asked
 * for. Recognising this costs no model call, which is the point — the common
 * case must not wait on an API.
 */
const APPROVALS = new Set([
  'oui',
  'ouais',
  'ouep',
  'ok',
  'okay',
  'oki',
  'o k',
  'go',
  'go go',
  'c est bon',
  'cest bon',
  'c est parti',
  'parfait',
  'nickel',
  'top',
  'banco',
  'valide',
  'je valide',
  'd accord',
  'daccord',
  'lance',
  'lance le',
  'lancer',
  'vas y',
  'vasy',
  'allez',
  'feu vert',
  'yes',
  'yep',
  'yup',
  '\u{1f44d}',
  '\u{1f44c}',
  'oui go',
  'ok go',
  'ok lance',
]);

export function isApproval(text: string): boolean {
  const normalised = text
    .normalize('NFD')
    // Strip the combining accents NFD just separated, so «validé» and
    // «valide» are one word.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Every apostrophe Telegram might deliver, then punctuation, then runs of
    // whitespace: «OK !», «ok...», «c’est bon.» are all the same answer.
    .replace(/[‘’`´']/g, ' ')
    .replace(/[!?.,;:\-_()[\]"«»…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalised === '') return false;
  return APPROVALS.has(normalised);
}

/** What the bot shows a human before asking them to approve (rule 8). */
export type SpecDigest = { title: string | null; intent: string | null; criteria: string[] };

/**
 * Reads a specification the way a human skims one: what it is called, what it
 * is for, and what it promises.
 *
 * Read from the FILE rather than from the agent's report: the file is the
 * contract, and a report that paraphrases it is one more thing that can drift.
 */
export function readSpecDigest(markdown: string): SpecDigest {
  const lines = markdown.split('\n');

  const titleLine = lines.find((line) => /^#\s+\S/.test(line));
  const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : null;

  const section = (heading: RegExp): string[] => {
    const start = lines.findIndex((line) => heading.test(line));
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^##\s/.test(line));
    return end === -1 ? rest : rest.slice(0, end);
  };

  const intentLines = section(/^##\s+Intent\s*$/i);
  const paragraph: string[] = [];
  for (const line of intentLines) {
    if (line.trim() === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const intent = paragraph.length > 0 ? paragraph.join(' ') : null;

  // A criterion wraps across lines in the file — every spec in this
  // repository is written to ~80 columns — so a continuation line belongs to
  // the bullet above it. Taking only the first line truncated half of them
  // mid-sentence, which in a chat reads as a spec that says nothing.
  const criteria: string[] = [];
  for (const line of section(/^##\s+Acceptance criteria\s*$/i)) {
    const bullet = /^\s*[-*]\s*\[[ xX]\]\s*(.*)$/.exec(line);
    if (bullet) {
      criteria.push((bullet[1] ?? '').trim());
      continue;
    }
    const last = criteria.length - 1;
    if (last >= 0 && /^\s+\S/.test(line)) {
      criteria[last] = `${criteria[last]} ${line.trim()}`.trim();
    }
  }

  return { title, intent, criteria: criteria.filter((line) => line !== '') };
}
