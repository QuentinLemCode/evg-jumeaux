/**
 * What the bot remembers of a conversation (spec 0014).
 *
 * Bounded, per chat, and written to disk after each turn — the gateway is
 * restarted by every deploy, and losing the thread because someone shipped a
 * CSS fix is not acceptable.
 *
 * It is NOT authority over anything. A message claiming «on avait dit 15
 * points» does not change how scoring works; the repository does. This exists
 * so that «et pour le classement ?» can be resolved against what came before.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Turn = { at: number; who: 'human' | 'bot'; text: string };

/**
 * What the bot is waiting on, with the request behind it.
 *
 * `question` is 0014's: the pipeline stopped and asked something. `approval`
 * is 0015's: a specification is written and nothing will be coded until a
 * human says yes, so it also carries the spec that approval would release.
 */
export type Pending = {
  kind: 'question' | 'approval';
  request: string;
  question: string;
  /** Only for `approval`: the spec file the code agent would implement. */
  spec?: string;
  at: number;
};

export type Conversation = { turns: Turn[]; pending: Pending | null };

/** Rule 2. A party group is chatty and a model's context is not free. */
export const MAX_TURNS = 20;

/** Long enough to be useful in a prompt, short enough not to dominate it. */
const MAX_TEXT = 1_500;

type Store = Record<string, Conversation>;

function empty(): Conversation {
  return { turns: [], pending: null };
}

/**
 * Accepts anything and returns only what is shaped right (rule 4).
 *
 * A corrupt store must cost one turn of context, never a crash: the gateway
 * that refuses to answer because its own cache is broken is worse than the one
 * that forgot yesterday.
 */
export function parseStore(raw: string): { store: Store; recovered: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store: {}, recovered: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { store: {}, recovered: false };
  }

  const store: Store = {};
  for (const [chat, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const candidate = value as Partial<Conversation>;
    const turns = Array.isArray(candidate.turns)
      ? candidate.turns.filter(
          (turn): turn is Turn =>
            typeof turn === 'object' &&
            turn !== null &&
            typeof (turn as Turn).text === 'string' &&
            ((turn as Turn).who === 'human' || (turn as Turn).who === 'bot'),
        )
      : [];
    const raw_pending = candidate.pending;
    const pending =
      raw_pending &&
      typeof raw_pending === 'object' &&
      typeof raw_pending.request === 'string' &&
      typeof raw_pending.question === 'string'
        ? {
            // A store written before 0015 has no `kind`, and every pending
            // entry in it was a question — that is what the field meant then.
            kind: raw_pending.kind === 'approval' ? ('approval' as const) : ('question' as const),
            request: raw_pending.request,
            question: raw_pending.question,
            ...(typeof raw_pending.spec === 'string' ? { spec: raw_pending.spec } : {}),
            at: raw_pending.at ?? 0,
          }
        : null;
    store[chat] = { turns: turns.slice(-MAX_TURNS), pending };
  }
  return { store, recovered: true };
}

export class Memory {
  private store: Store = {};

  /** True when a store existed and could not be understood (rule 4). */
  readonly lostOnStart: boolean;

  constructor(private readonly path: string) {
    let raw: string | null = null;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      // No file yet is the normal first run, not a loss.
      this.lostOnStart = false;
      return;
    }
    const { store, recovered } = parseStore(raw);
    this.store = store;
    this.lostOnStart = !recovered;
  }

  private chat(id: number): Conversation {
    const key = String(id);
    const existing = this.store[key];
    if (existing) return existing;
    const fresh = empty();
    this.store[key] = fresh;
    return fresh;
  }

  turns(id: number): readonly Turn[] {
    return this.chat(id).turns;
  }

  pending(id: number): Pending | null {
    return this.chat(id).pending;
  }

  record(id: number, who: Turn['who'], text: string, now = Date.now()): void {
    const conversation = this.chat(id);
    conversation.turns.push({ at: now, who, text: text.slice(0, MAX_TEXT) });
    if (conversation.turns.length > MAX_TURNS) {
      conversation.turns = conversation.turns.slice(-MAX_TURNS);
    }
    this.persist();
  }

  /** Records that the bot is waiting on an answer (0014 rule 6). */
  await_(id: number, request: string, question: string, now = Date.now()): void {
    this.chat(id).pending = { kind: 'question', request, question, at: now };
    this.persist();
  }

  /**
   * Records that a specification is written and waiting on a human
   * (0015 rule 11).
   *
   * Persisted like everything else, because the gateway is restarted by every
   * deploy and a specification nobody can approve any more is worse than one
   * that was never written.
   */
  awaitApproval(
    id: number,
    request: string,
    spec: string,
    question: string,
    now = Date.now(),
  ): void {
    this.chat(id).pending = { kind: 'approval', request, question, spec, at: now };
    this.persist();
  }

  resolve(id: number): void {
    this.chat(id).pending = null;
    this.persist();
  }

  /** Rule 13. Returns what was dropped, so the reply can say. */
  reset(id: number): { turns: number; hadPending: boolean } {
    const conversation = this.chat(id);
    const dropped = { turns: conversation.turns.length, hadPending: conversation.pending !== null };
    this.store[String(id)] = empty();
    this.persist();
    return dropped;
  }

  /** The history as the router is given it (rule 1). */
  transcript(id: number): string {
    const turns = this.chat(id).turns;
    if (turns.length === 0) return '';
    return turns.map((turn) => `${turn.who === 'human' ? 'Humain' : 'Bot'}: ${turn.text}`).join('\n');
  }

  private persist(): void {
    // Write then rename: a crash mid-write would otherwise leave exactly the
    // corrupt file rule 4 has to cope with.
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(this.store, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      // Rule: keep it in memory for this run. A journal line, no more — the
      // conversation must not stop because a disk did.
      console.warn(`hermes: could not persist memory (${String(error)})`);
    }
  }
}
