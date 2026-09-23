/**
 * The Telegram gateway (specs 0012 and 0016).
 *
 *     npm run hermes:gateway
 *
 * READ-ONLY since spec 0016. It answers questions about the app and its data,
 * and turns a bug report into a prompt for a coding agent. It starts no
 * process that writes to the repository, the database or production — making a
 * change is a human driving Antigravity remote control on the agents VM.
 *
 * The reason is not caution for its own sake: a bot nobody has to supervise
 * can only be a bot that cannot break anything. The pipeline it used to drive
 * needed a human at every step anyway, and the specification it wrote was read
 * for the first time in a chat window, which is not where a contract gets
 * read.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { Runner, since } from './jobs';
import { Memory } from './memory';
import {
  directedAtBot,
  isAuthorised,
  parseAllowlist,
  parseRouterReport,
  route,
  type Command,
} from './parse';
import { bugReply, stripAnsi } from './progress';
import { Telegram } from './telegram';

const run = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const AGENT = `${REPO_ROOT}/scripts/agent`;
const MEMORY_FILE = process.env.HERMES_MEMORY ?? `${REPO_ROOT}/data/hermes/conversations.json`;

const HELP = `Tague-moi avec :

/status   l'état de l'app, des services et des PR
/errors   les erreurs navigateur ouvertes
/logs     les dernières lignes de l'app
/reset    oublier notre conversation

Ou parle-moi normalement :

• « comment le score est calculé ? » — je lis les specs et le code
  et je réponds
• « qui a gagné le plus de points samedi ? » — je lis la base et
  je réponds
• « le classement colle au bord sur iPhone SE » — je résume le
  problème et je te donne un prompt à coller dans Antigravity

Je suis en lecture seule : je ne modifie ni le code, ni les specs, ni
la production. Pour changer quelque chose, ouvre une session
Antigravity sur la VM des agents.`;

/** Each command is one script. Nothing here builds a shell string. */
const SCRIPTS: Record<Command, { what: string; command: string; args: string[] } | null> = {
  status: { what: '/status', command: `${AGENT}/status.sh`, args: [] },
  errors: { what: '/errors', command: `${AGENT}/app-exec.sh`, args: ['client-errors'] },
  logs: { what: '/logs', command: `${AGENT}/app-exec.sh`, args: ['logs'] },
  help: null,
  reset: null,
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // There is no chat to apologise in, so the journal is the only audience.
    console.error(`hermes: ${name} is not set — refusing to start`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const tg = new Telegram(requireEnv('TELEGRAM_BOT_TOKEN'));
  const allowlist = parseAllowlist(process.env.TELEGRAM_ALLOWED_USERS);
  const runner = new Runner(REPO_ROOT);
  const memory = new Memory(MEMORY_FILE);
  if (memory.lostOnStart) {
    console.warn(`hermes: conversation store at ${MEMORY_FILE} was unreadable — starting empty`);
  }

  if (allowlist.length === 0) {
    // Rule 7: keep running and refuse everyone. A misconfigured allowlist must
    // never be an open door, and exiting would hide the misconfiguration.
    console.warn(
      'hermes: TELEGRAM_ALLOWED_USERS is empty — every request will be refused. ' +
        'Set it to the admins’ numeric Telegram ids.',
    );
  }

  const me = await tg.getMe();
  console.log(`hermes: @${me.username} (${me.id}) listening, ${allowlist.length} authorised id(s)`);

  let offset = 0;
  let backoff = 1_000;

  for (;;) {
    let updates;
    try {
      updates = await tg.getUpdates(offset);
      backoff = 1_000;
    } catch (error) {
      // Telegram unreachable, or a poll timed out in transit. Neither is worth
      // exiting over; both are worth slowing down for.
      console.warn(`hermes: poll failed (${String(error)}), retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      if (!update.message) continue;

      const directed = directedAtBot(update.message, me);
      if (!directed) continue; // Not for us. Silence is the whole point of rule 1.

      if (!isAuthorised(directed.fromId, allowlist)) {
        console.warn(`hermes: refused ${directed.fromLabel}`);
        await tg.send(directed.chatId, 'Tu n’es pas autorisé à me parler.', directed.messageId);
        continue;
      }

      await handle(tg, runner, memory, directed);
    }
  }
}

async function handle(
  tg: Telegram,
  runner: Runner,
  memory: Memory,
  directed: { text: string; chatId: number; messageId: number; fromLabel: string },
): Promise<void> {
  const decision = route(directed.text);

  // Recorded AFTER authorisation (0014 rule: an unauthorised message is never
  // remembered and so can never colour a later answer).
  memory.record(directed.chatId, 'human', directed.text);

  if (decision.kind === 'command' && decision.command === 'reset') {
    const dropped = memory.reset(directed.chatId);
    const said =
      dropped.turns === 0 && !dropped.hadPending
        ? 'Il n’y avait rien à oublier.'
        : `Oublié : ${dropped.turns} message(s)` +
          (dropped.hadPending ? ' et la question en attente.' : '.');
    await tg.send(directed.chatId, said, directed.messageId);
    return;
  }

  if (decision.kind === 'unknown-command') {
    await tg.send(
      directed.chatId,
      `Je ne connais pas ${decision.typed}.\n\n${HELP}`,
      directed.messageId,
    );
    return;
  }
  if (decision.kind === 'command' && decision.command === 'help') {
    await tg.send(directed.chatId, HELP, directed.messageId);
    return;
  }

  // Free text goes to the router, which answers it or turns it into a prompt.
  // Nothing is run for it (spec 0016, rule 1).
  if (decision.kind !== 'command') {
    await routeMessage(tg, memory, directed, decision.request);
    return;
  }

  const job = SCRIPTS[decision.command];
  if (!job) return;

  const busy = runner.running();
  if (busy) {
    await tg.send(
      directed.chatId,
      `Déjà occupé : ${busy.what}, ${since(busy.startedAt)}. Réessaie après.`,
      directed.messageId,
    );
    return;
  }

  // Rule 11: acknowledge BEFORE the work. A phone with no reply is
  // indistinguishable from a broken bot.
  const heading = `${job.what}…`;
  const ackId = await tg.send(directed.chatId, heading, directed.messageId);
  console.log(`hermes: ${directed.fromLabel} → ${job.what}`);

  const result = await runner.run(job.what, job.command, job.args, (tail) => {
    // 0012 rule 12: one message that changes, not nine notifications. 0016
    // rule 7 of its predecessor: never a terminal escape, because `docker` and
    // `gh` colour whether or not anyone is watching.
    void tg.edit(directed.chatId, ackId, `${heading}\n\n${clean(tail)}`);
  });

  if (!result) {
    // Lost a race with another request between the check and the start.
    await tg.edit(directed.chatId, ackId, `${heading}\n\nUn autre travail a démarré entre-temps.`);
    return;
  }

  const verdict = result.ok ? '✅' : '❌';
  await tg.edit(directed.chatId, ackId, `${heading}\n\n${verdict}\n${clean(result.output)}`);
  memory.record(directed.chatId, 'bot', `${verdict} ${job.what}`);
}

/** The last of a stream, with the terminal escapes taken out. */
function clean(output: string, limit = 3_000): string {
  return stripAnsi(output).trim().slice(-limit);
}

/**
 * Asks the router what the message wants, and deals with all three answers
 * here (specs 0013 and 0016).
 *
 * Nothing is started in any branch. A `bug` produces text — a summary and a
 * prompt — and a human decides whether that text ever becomes a change.
 */
async function routeMessage(
  tg: Telegram,
  memory: Memory,
  directed: { chatId: number; messageId: number; fromLabel: string },
  message: string,
): Promise<void> {
  const thinking = await tg.send(directed.chatId, 'Je regarde…', directed.messageId);

  // Its own Runner, not the shared one: routing is not a job, so a question
  // can be answered while /status is running (0013 rule 11).
  const router = new Runner(REPO_ROOT);
  const result = await router.run('route', `${AGENT}/route.sh`, [
    '--context',
    await writeContext(memory, directed.chatId),
    message,
  ]);
  const routed = result ? parseRouterReport(result.output) : null;

  if (!routed) {
    await tg.edit(
      directed.chatId,
      thinking,
      'Je n’ai pas réussi à interpréter ta demande.\n\n' +
        (result?.output
          ? `Sortie du routeur :\n${clean(result.output, 1_500)}`
          : 'Le routeur n’a rien renvoyé.'),
    );
    return;
  }

  const body = routed.decision === 'bug' ? bugReply(routed.body) : routed.body;

  await tg.edit(directed.chatId, thinking, body);
  memory.record(directed.chatId, 'bot', body);

  // An `unclear` is a question the bot is now waiting on (0014 rule 6).
  if (routed.decision === 'unclear') memory.await_(directed.chatId, message, routed.body);
  else memory.resolve(directed.chatId);

  console.log(`hermes: ${directed.fromLabel} → ${routed.decision}`);
}

/** Rule 13: one snapshot per minute, however chatty the group is. */
let cached: { at: number; text: string } | null = null;
const SNAPSHOT_TTL = 60_000;

/**
 * The application data, read-only and bounded (spec 0016, rules 10-14).
 *
 * `null` rather than a throw when it cannot be read: a question about the code
 * must still get an answer, and «la base est injoignable» is a better reply
 * than silence.
 */
async function snapshot(now = Date.now()): Promise<string | null> {
  if (cached && now - cached.at < SNAPSHOT_TTL) return cached.text;
  try {
    const { stdout } = await run(`${AGENT}/app-exec.sh`, ['data'], {
      cwd: REPO_ROOT,
      timeout: 20_000,
      maxBuffer: 4_000_000,
    });
    cached = { at: now, text: stdout };
    return stdout;
  } catch (error) {
    console.warn(`hermes: could not read the data snapshot (${String(error)})`);
    return null;
  }
}

/**
 * What the router is given (spec 0014 rule 1, spec 0016 rule 10), in a file
 * rather than an argument: a chat contains quotes, newlines and whatever a
 * guest typed, and so does a database.
 */
async function writeContext(memory: Memory, chatId: number): Promise<string> {
  const transcript = memory.transcript(chatId);
  const pending = memory.pending(chatId);
  const data = await snapshot();

  const body = [
    '## Conversation',
    '',
    transcript || '(rien pour l’instant)',
    '',
    '## En attente',
    '',
    pending
      ? `Question posée : ${pending.question}\nDemande d’origine : ${pending.request}`
      : '(rien)',
    '',
    '## Données',
    '',
    data ??
      '(injoignable — réponds sur le code et dis que tu n’as pas pu lire la base)',
  ].join('\n');

  const path = join(mkdtempSync(join(tmpdir(), 'hermes-ctx-')), 'context.md');
  writeFileSync(path, `${body}\n`, { mode: 0o600 });
  return path;
}

main().catch((error) => {
  // Rule 15: systemd restarts it, and the journal says why. Silence is the one
  // failure mode this whole gateway exists to remove.
  console.error('hermes: fatal', error);
  process.exit(1);
});
