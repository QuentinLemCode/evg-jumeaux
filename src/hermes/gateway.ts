/**
 * The Telegram gateway (spec 0012).
 *
 * Replaces `/home/hermes/.local/bin/hermes`, a binary this repository pointed
 * systemd at and never shipped: the unit was enabled and dead, so tagging the
 * bot produced silence with no error anywhere.
 *
 *     npm run hermes:gateway
 *
 * It carries commands and change requests to `scripts/agent/` and reports back.
 * It holds no conversation — a model driving `hermes/tools.json` sits on top of
 * this transport and is a separate spec.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Runner, since } from './jobs';
import { Memory } from './memory';
import {
  directedAtBot,
  isAuthorised,
  parseAllowlist,
  parsePipelineReport,
  parseRouterReport,
  route,
  type Command,
} from './parse';
import { Telegram } from './telegram';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const AGENT = `${REPO_ROOT}/scripts/agent`;
const MEMORY_FILE = process.env.HERMES_MEMORY ?? `${REPO_ROOT}/data/hermes/conversations.json`;

const HELP = `Tague-moi avec :

/status   l'état de l'app, des services et des PR
/errors   les erreurs navigateur ouvertes
/logs     les dernières lignes de l'app
/deploy   redéployer la dernière image
/reset    oublier notre conversation

Ou parle-moi normalement :

• une question — « comment le score est calculé ? » — et je réponds
• une demande — « corrige les marges du classement sur iPhone SE » —
  et j'écris la spec, je fais coder, relire, et j'ouvre une PR qui se
  fusionne si la CI passe

Si ta demande est trop vague pour être spécifiée, je te pose une
question plutôt que de deviner.`;

/** Each command is one script. Nothing here builds a shell string. */
const SCRIPTS: Record<Command, { what: string; command: string; args: string[] } | null> = {
  status: { what: '/status', command: `${AGENT}/status.sh`, args: [] },
  errors: { what: '/errors', command: `${AGENT}/app-exec.sh`, args: ['client-errors'] },
  logs: { what: '/logs', command: `${AGENT}/app-exec.sh`, args: ['logs'] },
  deploy: { what: '/deploy', command: `${AGENT}/app-exec.sh`, args: ['deploy'] },
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
        await tg.send(
          directed.chatId,
          'Tu n’es pas autorisé à piloter le pipeline.',
          directed.messageId,
        );
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

  // Free text goes through the router first (spec 0013): the bot decides
  // whether it was asked a question or asked to change something. Commands
  // bypass it — they already say what they want.
  let job: { what: string; command: string; args: string[] } | null;
  let requestForPipeline: string | null = null;
  if (decision.kind === 'command') {
    job = SCRIPTS[decision.command];
  } else {
    const routed = await routeMessage(tg, runner, memory, directed, decision.request);
    if (!routed) return;
    requestForPipeline = routed;
    job = { what: 'pipeline', command: `${AGENT}/pipeline.sh`, args: [routed] };
  }
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
  const heading =
    decision.kind === 'command'
      ? `${job.what}…`
      : `« ${job.args[0]} »\n\nJe m’en occupe…`;
  const ackId = await tg.send(directed.chatId, heading, directed.messageId);
  console.log(`hermes: ${directed.fromLabel} → ${job.what}`);

  const result = await runner.run(job.what, job.command, job.args, (tail) => {
    // Rule 12: one message that changes, not nine notifications.
    void tg.edit(directed.chatId, ackId, `${heading}\n\n${tail}`);
  });

  if (!result) {
    // Lost a race with another request between the check and the start.
    await tg.edit(directed.chatId, ackId, `${heading}\n\nUn autre travail a démarré entre-temps.`);
    return;
  }

  // A blocked pipeline is a QUESTION, not a filed ticket (spec 0014, rules
  // 6-8). The previous behaviour dumped the raw report and stopped, leaving a
  // state only a terminal could resolve — during a weekend away, that is a
  // request that never happens.
  const outcome = parsePipelineReport(result.output);

  if (outcome?.status === 'needs-human' && outcome.reason) {
    const question =
      `${heading}\n\n⏸ Je me suis arrêté là :\n\n${outcome.reason}\n\n` +
      'Réponds-moi ici et je reprends — pas besoin de toucher au dépôt.';
    await tg.edit(directed.chatId, ackId, question);
    memory.record(directed.chatId, 'bot', `Arrêté : ${outcome.reason}`);
    // Remember what was asked AND the request behind it, so the next message
    // can be merged into a request the pipeline can restart from (rule 9).
    memory.await_(directed.chatId, requestForPipeline ?? job.what, outcome.reason);
    console.log(`hermes: ${directed.fromLabel} → needs-human (${outcome.reason.slice(0, 80)})`);
    return;
  }

  const verdict = result.ok ? '✅' : '❌';
  const tail = outcome?.pr ? `${outcome.pr}\n\n${result.output}` : result.output;
  await tg.edit(directed.chatId, ackId, `${heading}\n\n${verdict}\n${tail}`);
  memory.record(directed.chatId, 'bot', `${verdict} ${outcome?.pr ?? outcome?.status ?? ''}`.trim());
  if (result.ok) memory.resolve(directed.chatId);
}


/**
 * Asks the router what the message wants, and answers it there and then when
 * it is a question (spec 0013).
 *
 * Returns the request to hand the pipeline, or `null` when there is nothing
 * more to do — an answer was posted, a clarification was asked for, or the
 * router failed.
 *
 * On failure it runs NOTHING (rule 12). There is deliberately no fallback to
 * the pipeline: "we could not tell what you meant, so we changed the app" is
 * not a failure mode worth having.
 */
async function routeMessage(
  tg: Telegram,
  runner: Runner,
  memory: Memory,
  directed: { chatId: number; messageId: number; fromLabel: string },
  message: string,
): Promise<string | null> {
  const thinking = await tg.send(directed.chatId, 'Je regarde…', directed.messageId);

  // Not through the Runner's lock: routing is not a job, so a question can be
  // answered while a pipeline runs (0013 rule 11).
  const router = new Runner(REPO_ROOT);
  const result = await router.run('route', `${AGENT}/route.sh`, [
    '--context',
    writeContext(memory, directed.chatId),
    message,
  ]);
  const routed = result ? parseRouterReport(result.output) : null;

  if (!routed) {
    await tg.edit(
      directed.chatId,
      thinking,
      'Je n’ai pas réussi à interpréter ta demande, donc je n’ai rien lancé.\n\n' +
        (result?.output
          ? `Sortie du routeur :\n${result.output}`
          : 'Le routeur n’a rien renvoyé.'),
    );
    return null;
  }

  if (routed.decision === 'answer' || routed.decision === 'unclear') {
    await tg.edit(directed.chatId, thinking, routed.body);
    memory.record(directed.chatId, 'bot', routed.body);
    // An `unclear` is a question the bot is now waiting on, exactly like one
    // from a blocked pipeline (0014 rule 6).
    if (routed.decision === 'unclear') memory.await_(directed.chatId, message, routed.body);
    console.log(`hermes: ${directed.fromLabel} → ${routed.decision}`);
    return null;
  }

  // A change, and the pipeline is about to run. Check the lock before the
  // acknowledgement so a refusal does not read like a start.
  const busy = runner.running();
  if (busy) {
    await tg.edit(
      directed.chatId,
      thinking,
      `Déjà occupé : ${busy.what}, ${since(busy.startedAt)}. Réessaie après.`,
    );
    return null;
  }

  const understood = `Compris : « ${routed.body} »`;
  await tg.edit(directed.chatId, thinking, understood);
  memory.record(directed.chatId, 'bot', understood);
  // The request carried the answer, so nothing is pending any more.
  memory.resolve(directed.chatId);
  return routed.body;
}

/**
 * The conversation as the router is given it (spec 0014, rule 1), in a file
 * rather than an argument: a chat contains quotes, newlines and whatever a
 * guest typed, none of which belongs on a command line.
 */
function writeContext(memory: Memory, chatId: number): string {
  const transcript = memory.transcript(chatId);
  const pending = memory.pending(chatId);
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
