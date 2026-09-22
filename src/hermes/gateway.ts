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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { isApproval, readSpecDigest, renderStages, stripAnsi } from './progress';
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
  et j'écris la spécification, je te la soumets, et je ne code
  qu'une fois que tu as répondu « oui ». Ensuite je fais coder,
  relire, et j'ouvre une PR qui se fusionne si la CI passe.

Si ta demande est trop vague pour être spécifiée, je te pose une
question plutôt que de deviner. Et si la spécification ne te va pas,
réponds-moi ce qu'il faut changer : je la réécris sans que tu aies à
tout retaper.`;

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
    // A specification waiting on a human short-circuits the router entirely
    // (spec 0015). Asking a model whether «oui» means yes would cost a round
    // trip to learn what a Set already knows.
    const waiting = memory.pending(directed.chatId);
    const approving = waiting?.kind === 'approval' ? waiting : null;

    if (approving?.spec !== undefined && isApproval(decision.request)) {
      // Rule 9. Cleared before the run, so a second «oui» cannot start it
      // twice.
      requestForPipeline = approving.request;
      job = {
        what: 'code',
        command: `${AGENT}/pipeline.sh`,
        args: ['--from-spec', approving.spec],
      };
      memory.resolve(directed.chatId);
    } else if (approving !== null) {
      // Rule 10. Anything that is not an approval is a correction to the
      // specification, and the human must not have to repeat the whole
      // request for it — the spec agent never sees this conversation.
      requestForPipeline = `${approving.request}\n\nPrécision demandée ensuite : ${decision.request}`;
      job = {
        what: 'spec',
        command: `${AGENT}/pipeline.sh`,
        args: ['--spec-only', requestForPipeline],
      };
      memory.resolve(directed.chatId);
    } else if (isApproval(decision.request)) {
      // Rule 12. «oui» on its own must never start a pipeline.
      await tg.send(
        directed.chatId,
        'Il n’y a rien à valider pour l’instant.',
        directed.messageId,
      );
      return;
    } else {
      const routed = await routeMessage(tg, runner, memory, directed, decision.request);
      if (!routed) return;
      requestForPipeline = routed.request;
      job =
        routed.kind === 'fix'
          ? // A repair of the machinery, not a product change: no numbered spec,
            // and the pull request it opens cannot merge until a human adds the
            // `infra-ok` label. See scripts/agent/fix.sh.
            { what: 'fix', command: `${AGENT}/fix.sh`, args: [routed.request] }
          : // The SPECIFICATION only. Nothing is coded until a human has read
            // it and said yes (spec 0015, rule 8).
            {
              what: 'spec',
              command: `${AGENT}/pipeline.sh`,
              args: ['--spec-only', routed.request],
            };
    }
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
  const heading = headingFor(job, decision.kind === 'command', requestForPipeline);
  const ackId = await tg.send(directed.chatId, heading, directed.messageId);
  console.log(`hermes: ${directed.fromLabel} → ${job.what}`);

  const result = await runner.run(job.what, job.command, job.args, (tail) => {
    // Rule 12 of 0012: one message that changes, not nine notifications.
    // Rules 5-7 of 0015: stages, not a wall of an agent's stream, and never
    // a terminal escape.
    void tg.edit(directed.chatId, ackId, `${heading}\n\n${progress(tail)}`);
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

  // A specification is written and NOTHING has been coded (spec 0015, rule
  // 8). The human reads it and decides; that is the whole point of splitting
  // the run here.
  if (outcome?.status === 'spec-ready' && outcome.spec) {
    const presented = presentSpec(outcome.spec);
    await tg.edit(
      directed.chatId,
      ackId,
      `${heading}\n\n${progress(result.output, { finished: true, ok: true })}\n\n${presented}`,
    );
    memory.record(directed.chatId, 'bot', presented);
    memory.awaitApproval(
      directed.chatId,
      requestForPipeline ?? job.what,
      outcome.spec,
      'Spécification à valider',
    );
    console.log(`hermes: ${directed.fromLabel} → spec-ready (${outcome.spec})`);
    return;
  }

  const verdict = result.ok ? '✅' : '❌';
  const tail = outcome?.pr ? `${outcome.pr}\n\n${stripAnsi(result.output)}` : stripAnsi(result.output);
  const stages = progress(result.output, { finished: true, ok: result.ok });
  await tg.edit(
    directed.chatId,
    ackId,
    `${heading}\n\n${stages}${stages === '' ? '' : '\n\n'}${verdict}\n${tail}`,
  );
  memory.record(directed.chatId, 'bot', `${verdict} ${outcome?.pr ?? outcome?.status ?? ''}`.trim());
  if (result.ok) memory.resolve(directed.chatId);
}

/** The first line of the one message a request gets (0012 rule 12). */
function headingFor(
  job: { what: string; args: string[] },
  isCommand: boolean,
  request: string | null,
): string {
  if (isCommand) return `${job.what}…`;
  if (job.what === 'code') return '▶️ Spécification validée. Je code.';
  return `« ${request ?? job.args[job.args.length - 1] ?? ''} »`;
}

/**
 * What a running job looks like on a phone: the stages, and the tail of the
 * stream only when there are no stages to show yet.
 */
function progress(output: string, state: { finished?: boolean; ok?: boolean } = {}): string {
  const stages = renderStages(output, state);
  if (stages !== '') return stages;
  // No STEP line yet — a short script, or one that has not reached its first
  // stage. The raw tail is better than nothing, with the escapes taken out.
  const clean = stripAnsi(output).trim();
  return clean.slice(-500);
}

/**
 * The specification, as a human reads it before approving (rule 8).
 *
 * Read from the file on disk: it is the contract, and the agent's own summary
 * of it is one more thing that can drift from what was actually written.
 */
function presentSpec(spec: string): string {
  let digest;
  try {
    digest = readSpecDigest(readFileSync(resolve(REPO_ROOT, spec), 'utf8'));
  } catch {
    return (
      `La spécification est écrite dans ${spec}, mais je n’arrive pas à la relire.\n\n` +
      'Réponds « oui » pour lancer le code quand même, ou dis-moi quoi changer.'
    );
  }

  const criteria = digest.criteria.slice(0, 12).map((line) => `• ${line}`);
  const more =
    digest.criteria.length > criteria.length
      ? `\n• … et ${digest.criteria.length - criteria.length} autre(s)`
      : '';

  return [
    `📄 ${digest.title ?? spec}`,
    `\`${spec}\``,
    '',
    digest.intent ?? '(pas de section Intent)',
    '',
    criteria.length > 0 ? `Ce que ça promet :\n${criteria.join('\n')}${more}` : '',
    '',
    '👉 Réponds « oui » pour que je lance le code, ou dis-moi ce qu’il faut changer.',
  ]
    .filter((part, index, all) => !(part === '' && all[index - 1] === ''))
    .join('\n');
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
): Promise<{ kind: 'change' | 'fix'; request: string } | null> {
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

  const understood =
    routed.decision === 'fix'
      ? `Réparation : « ${routed.body} »\n\nJe corrige la machinerie — la PR demandera ton feu vert.`
      : // Says what happens next, because what happens next is a pause: the
        // specification comes back for approval and no code is written until
        // then (spec 0015, rule 8).
        `Compris : « ${routed.body} »\n\nJ’écris la spécification et je te la soumets avant de coder.`;
  await tg.edit(directed.chatId, thinking, understood);
  memory.record(directed.chatId, 'bot', understood);
  // The request carried the answer, so nothing is pending any more.
  memory.resolve(directed.chatId);
  return { kind: routed.decision === 'fix' ? 'fix' : 'change', request: routed.body };
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
