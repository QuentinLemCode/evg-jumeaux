/**
 * The pure half of the Telegram gateway (spec 0012).
 *
 * Everything here is a function of its arguments: what a message asks for, who
 * asked, and what fits in a reply. The half that talks to the network and
 * spawns processes lives elsewhere, so this can be tested without either.
 */

/** Only the fields we use, so a Telegram schema change cannot break a type. */
export type TgEntity = {
  type: string;
  offset: number;
  length: number;
  user?: { id: number };
};

export type TgMessage = {
  message_id: number;
  from?: { id: number; username?: string; first_name?: string };
  chat: { id: number; type: string };
  text?: string;
  entities?: TgEntity[];
};

export type TgUpdate = { update_id: number; message?: TgMessage };

export type Directed = {
  /** The message text with every mention of the bot removed. */
  text: string;
  fromId: number;
  chatId: number;
  messageId: number;
  /** For the log line on a refusal. */
  fromLabel: string;
};

/**
 * Is this message addressed to the bot, and what does it say once the mention
 * is taken out? (rules 1-3)
 *
 * `null` means "not for us", which is the common case in a group chat and must
 * stay completely silent.
 *
 * The mention has to be a real Telegram **entity**. A message whose text merely
 * contains `@evg_bot` — quoted from someone else, or pasted — is not a mention,
 * and treating it as one is how a forwarded message triggers a deploy.
 */
export function directedAtBot(
  message: TgMessage,
  bot: { username: string; id: number },
): Directed | null {
  const text = message.text;
  if (text === undefined || message.from === undefined) return null;

  const wanted = `@${bot.username}`.toLowerCase();
  const mentions = (message.entities ?? []).filter((entity) => {
    if (entity.type === 'text_mention') return entity.user?.id === bot.id;
    if (entity.type !== 'mention') return false;
    // Telegram entity offsets and lengths are in UTF-16 code units, which is
    // exactly how a JavaScript string is indexed — so slicing is correct even
    // when the message contains emoji, and converting anything would break it.
    return text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === wanted;
  });

  if (mentions.length === 0) return null;

  // Right to left, so each removal leaves the earlier offsets valid.
  let stripped = text;
  for (const entity of [...mentions].sort((a, b) => b.offset - a.offset)) {
    stripped = stripped.slice(0, entity.offset) + stripped.slice(entity.offset + entity.length);
  }

  return {
    text: stripped.replace(/\s+/g, ' ').trim(),
    fromId: message.from.id,
    chatId: message.chat.id,
    messageId: message.message_id,
    fromLabel: message.from.username
      ? `@${message.from.username} (${message.from.id})`
      : `${message.from.first_name ?? 'inconnu'} (${message.from.id})`,
  };
}

/** Who may drive the pipeline (rules 5-7). */
export function isAuthorised(fromId: number, allowlist: readonly number[]): boolean {
  // An empty allowlist authorises NOBODY. The opposite reading turns a
  // forgotten variable into an open door.
  return allowlist.includes(fromId);
}

/** `TELEGRAM_ALLOWED_USERS` is a comma-separated list of numeric ids. */
export function parseAllowlist(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
}

export type Command = 'status' | 'errors' | 'logs' | 'deploy' | 'help' | 'reset';

export type Route =
  | { kind: 'command'; command: Command }
  | { kind: 'request'; request: string }
  | { kind: 'unknown-command'; typed: string };

const COMMANDS: Record<string, Command> = {
  '/status': 'status',
  '/errors': 'errors',
  '/logs': 'logs',
  '/deploy': 'deploy',
  '/help': 'help',
  '/start': 'help',
  // Spec 0014 rule 13: forget this chat's history and pending question.
  '/reset': 'reset',
};

/**
 * What the message asks for (rules 4, 8, 9).
 *
 * A mention and nothing else is help, not an empty request — the pipeline must
 * never be started by someone tapping the bot's name by accident.
 */
export function route(text: string): Route {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'command', command: 'help' };

  if (trimmed.startsWith('/')) {
    // In a group Telegram appends the bot's username to commands:
    // `/status@evg_bot`. Strip it before matching.
    const word = trimmed.split(/\s+/)[0] ?? '';
    const bare = (word.split('@')[0] ?? '').toLowerCase();
    const command = COMMANDS[bare];
    return command ? { kind: 'command', command } : { kind: 'unknown-command', typed: word };
  }

  return { kind: 'request', request: trimmed };
}

/** Telegram refuses a message body over this. */
export const TELEGRAM_LIMIT = 4096;

/**
 * Fit text into one Telegram message, keeping the END (rule 14).
 *
 * The tail is the useful part of a failing log: the error is at the bottom, and
 * a head-first truncation reliably throws away the only lines anyone wants.
 */
export function truncateForTelegram(text: string, limit = TELEGRAM_LIMIT): string {
  if (text.length <= limit) return text;

  const marker = '[…]\n';
  const room = limit - marker.length;
  const tail = text.slice(text.length - room);
  // Start at a line boundary so the first line is not a fragment.
  const newline = tail.indexOf('\n');
  return marker + (newline === -1 ? tail : tail.slice(newline + 1));
}

/** What the router decided about one message (spec 0013, rule 1). */
export type RouterDecision = 'answer' | 'change' | 'fix' | 'unclear';

export type Routed = { decision: RouterDecision; body: string };

/**
 * Reads the router's report (spec 0013).
 *
 * `null` means the report could not be understood — and the caller must then do
 * NOTHING (rule 12). "We could not tell what you meant, so we changed the app"
 * is not an acceptable failure mode, so there is deliberately no fallback here.
 *
 * The report arrives mixed with whatever the agent runtime wrote to its own
 * output, so the decision is SEARCHED for rather than expected on line one. The
 * LAST match wins: a model that restates the format while thinking would
 * otherwise have its rehearsal taken for its verdict.
 */
export function parseRouterReport(output: string): Routed | null {
  const lines = output.split('\n');

  let at = -1;
  let decision: RouterDecision | null = null;
  for (const [index, line] of lines.entries()) {
    const match = /^\s*DECISION:\s*(answer|change|fix|unclear)\s*$/i.exec(line);
    if (match?.[1]) {
      at = index;
      decision = match[1].toLowerCase() as RouterDecision;
    }
  }
  if (decision === null || at === -1) return null;

  // The `---` is OPTIONAL, and that is a correction. The router is a language
  // model asked to emit a separator, and one run in three forgets it —
  // producing `DECISION: change` followed straight by the request. Refusing
  // that meant answering «je n'ai pas réussi à interpréter ta demande» to a
  // decision the model had in fact made, and got right.
  //
  // Nothing is lost by dropping the requirement: everything after the
  // DECISION line is the body either way.
  const separator = lines.findIndex((line, index) => index > at && line.trim() === '---');
  const start = separator === -1 ? at + 1 : separator + 1;

  const body = lines.slice(start).join('\n').trim();
  // An empty body is useless whatever the decision: an answer nobody can read,
  // a clarifying question that asks nothing, a request with no request in it.
  if (body === '') return null;

  return { decision, body };
}

export type PipelineOutcome = {
  /** `ok`, `needs-human`, `spec-ready`, or whatever the script said. */
  status: string;
  /** The agent's own words about what is blocking. Never fabricated here. */
  reason: string | null;
  pr: string | null;
  /** The specification the run produced or worked from (spec 0015, rule 1). */
  spec: string | null;
};

/**
 * Reads what `pipeline.sh` reported (spec 0014, rule 7).
 *
 * `reason` is whatever the script said and nothing else. The bot has to be able
 * to post the real blocker in the chat, and the failure this exists to prevent
 * is announcing «the spec has open questions» when the truth was a permission
 * error that never reached the model.
 */
export function parsePipelineReport(output: string): PipelineOutcome | null {
  const field = (key: string): string | null => {
    // Last match wins: the pipeline prints each stage's report as it goes, so
    // the final block is the verdict.
    let found: string | null = null;
    for (const line of output.split('\n')) {
      const match = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`).exec(line);
      if (match?.[1]) found = match[1];
    }
    return found;
  };

  const status = field('PIPELINE');
  if (status === null) return null;

  const reason = field('REASON');
  const pr = field('PR');
  const spec = field('SPEC_FILE');
  return {
    status,
    reason: reason && reason !== 'none' ? reason : null,
    pr: pr && pr !== 'none' ? pr : null,
    spec: spec && spec !== 'none' ? spec : null,
  };
}
