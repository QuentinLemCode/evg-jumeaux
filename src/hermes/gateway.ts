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
import { resolve } from 'node:path';

import { Runner, since } from './jobs';
import {
  directedAtBot,
  isAuthorised,
  parseAllowlist,
  parseRouterReport,
  route,
  type Command,
} from './parse';
import { Telegram } from './telegram';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const AGENT = `${REPO_ROOT}/scripts/agent`;

const HELP = `Tague-moi avec :

/status   l'état de l'app, des services et des PR
/errors   les erreurs navigateur ouvertes
/logs     les dernières lignes de l'app
/deploy   redéployer la dernière image

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
};


/**
 * Debug logging, off unless HERMES_DEBUG is set.
 *
 * Kept off by default because a party group is chatty and every message it
 * carries would be logged; kept AVAILABLE because without it "the bot does not
 * answer" has two indistinguishable causes.
 */
const DEBUG = process.env.HERMES_DEBUG === '1';
function debug(message: string): void {
  if (DEBUG) console.log(`hermes: [debug] ${message}`);
}

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

  if (allowlist.length === 0) {
    // Rule 7: keep running and refuse everyone. A misconfigured allowlist must
    // never be an open door, and exiting would hide the misconfiguration.
    console.warn(
      'hermes: TELEGRAM_ALLOWED_USERS is empty — every request will be refused. ' +
        'Set it to the admins’ numeric Telegram ids.',
    );
  }

  const me = await tg.getMe();
  console.log(
    `hermes: @${me.username} (${me.id}) listening, ${allowlist.length} authorised id(s), ` +
      `debug=${DEBUG ? 'on' : 'off'}`,
  );
  if (me.canReadAllGroupMessages === false) {
    // Privacy mode. Telegram then delivers only commands, @mentions and
    // replies — and a changed setting takes effect only after the bot is
    // REMOVED from the group and added again, which is the step everyone
    // misses.
    console.warn(
      'hermes: privacy mode is ON (can_read_all_group_messages=false). Mentions and ' +
        'commands should still arrive; plain text will not. If nothing arrives at all, ' +
        'disable privacy in BotFather (/setprivacy) and then RE-ADD the bot to the group.',
    );
  }

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

    if (updates.length > 0) debug(`poll returned ${updates.length} update(s)`);

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      if (!update.message) continue;

      const directed = directedAtBot(update.message, me);
      if (!directed) {
        // Silence towards the CHAT is rule 1. Silence towards the operator was
        // my own doing, and it made two very different situations look
        // identical: "Telegram delivers nothing" and "it arrives and the
        // mention is not recognised". One is a BotFather setting, the other is
        // a bug here, and there was no way to tell them apart.
        debug(
          `ignored update ${update.update_id}: chat=${update.message.chat.type} ` +
            `entities=${(update.message.entities ?? []).map((e) => e.type).join(',') || 'none'} ` +
            `text=${JSON.stringify((update.message.text ?? '').slice(0, 60))}`,
        );
        continue;
      }

      if (!isAuthorised(directed.fromId, allowlist)) {
        console.warn(`hermes: refused ${directed.fromLabel}`);
        await tg.send(
          directed.chatId,
          'Tu n’es pas autorisé à piloter le pipeline.',
          directed.messageId,
        );
        continue;
      }

      await handle(tg, runner, directed);
    }
  }
}

async function handle(
  tg: Telegram,
  runner: Runner,
  directed: { text: string; chatId: number; messageId: number; fromLabel: string },
): Promise<void> {
  const decision = route(directed.text);

  if (decision.kind === 'unknown-command') {
    await tg.send(directed.chatId, `Je ne connais pas ${decision.typed}.\n\n${HELP}`, directed.messageId);
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
  if (decision.kind === 'command') {
    job = SCRIPTS[decision.command];
  } else {
    const routed = await routeMessage(tg, runner, directed, decision.request);
    if (!routed) return;
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

  const verdict = result.ok ? '✅' : '❌';
  await tg.edit(directed.chatId, ackId, `${heading}\n\n${verdict}\n${result.output}`);
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
  directed: { chatId: number; messageId: number; fromLabel: string },
  message: string,
): Promise<string | null> {
  const thinking = await tg.send(directed.chatId, 'Je regarde…', directed.messageId);

  // Not through the Runner's lock: routing is not a job, so a question can be
  // answered while a pipeline runs (rule 11).
  const router = new Runner(REPO_ROOT);
  const result = await router.run('route', `${AGENT}/route.sh`, [message]);
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

  await tg.edit(directed.chatId, thinking, `Compris : « ${routed.body} »`);
  return routed.body;
}

main().catch((error) => {
  // Rule 15: systemd restarts it, and the journal says why. Silence is the one
  // failure mode this whole gateway exists to remove.
  console.error('hermes: fatal', error);
  process.exit(1);
});
