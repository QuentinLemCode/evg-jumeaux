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
import { directedAtBot, isAuthorised, parseAllowlist, route, type Command } from './parse';
import { Telegram } from './telegram';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const AGENT = `${REPO_ROOT}/scripts/agent`;

const HELP = `Tague-moi avec :

/status   l'état de l'app, des services et des PR
/errors   les erreurs navigateur ouvertes
/logs     les dernières lignes de l'app
/deploy   redéployer la dernière image

Ou écris simplement ce que tu veux changer, par exemple
« ajoute un mur de photos » : j'écris la spec, je fais coder,
je fais relire, et j'ouvre une PR qui se fusionne si la CI passe.`;

/** Each command is one script. Nothing here builds a shell string. */
const SCRIPTS: Record<Command, { what: string; command: string; args: string[] } | null> = {
  status: { what: '/status', command: `${AGENT}/status.sh`, args: [] },
  errors: { what: '/errors', command: `${AGENT}/app-exec.sh`, args: ['client-errors'] },
  logs: { what: '/logs', command: `${AGENT}/app-exec.sh`, args: ['logs'] },
  deploy: { what: '/deploy', command: `${AGENT}/app-exec.sh`, args: ['deploy'] },
  help: null,
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

  const job =
    decision.kind === 'command'
      ? SCRIPTS[decision.command]
      : { what: 'pipeline', command: `${AGENT}/pipeline.sh`, args: [decision.request] };
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
  const heading = decision.kind === 'command' ? `${job.what}…` : `« ${decision.request} »\n\nJe m’en occupe…`;
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

main().catch((error) => {
  // Rule 15: systemd restarts it, and the journal says why. Silence is the one
  // failure mode this whole gateway exists to remove.
  console.error('hermes: fatal', error);
  process.exit(1);
});
