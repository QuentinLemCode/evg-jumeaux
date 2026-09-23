import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_TURNS, Memory, parseStore } from './memory';

const store = () => join(mkdtempSync(join(tmpdir(), 'hermes-')), 'conversations.json');

describe('Memory', () => {
  it('starts empty and remembers turns in order', () => {
    const memory = new Memory(store());
    expect(memory.turns(1)).toEqual([]);
    memory.record(1, 'human', 'salut');
    memory.record(1, 'bot', 'salut à toi');
    expect(memory.turns(1).map((t) => t.text)).toEqual(['salut', 'salut à toi']);
  });

  it('keeps chats apart', () => {
    const memory = new Memory(store());
    memory.record(1, 'human', 'dans le groupe');
    memory.record(2, 'human', 'en privé');
    expect(memory.turns(1)).toHaveLength(1);
    expect(memory.turns(2).map((t) => t.text)).toEqual(['en privé']);
  });

  it('caps the history, dropping the oldest', () => {
    const memory = new Memory(store());
    for (let i = 0; i < MAX_TURNS + 5; i += 1) memory.record(1, 'human', `message ${i}`);
    expect(memory.turns(1)).toHaveLength(MAX_TURNS);
    expect(memory.turns(1)[0]?.text).toBe('message 5');
  });

  it('survives a restart', () => {
    // The gateway is restarted by every deploy (rule 3).
    const path = store();
    const first = new Memory(path);
    first.record(1, 'human', 'avant le déploiement');
    first.await_(1, 'ajoute un mur de photos', 'Quel écran ?');

    const second = new Memory(path);
    expect(second.turns(1).map((t) => t.text)).toEqual(['avant le déploiement']);
    expect(second.pending(1)?.question).toBe('Quel écran ?');
    expect(second.lostOnStart).toBe(false);
  });

  it('starts empty rather than crashing on a corrupt store', () => {
    const path = store();
    writeFileSync(path, '{ this is not json');
    const memory = new Memory(path);
    expect(memory.turns(1)).toEqual([]);
    expect(memory.lostOnStart).toBe(true);
  });

  it('is silent about a store that simply does not exist yet', () => {
    expect(new Memory(store()).lostOnStart).toBe(false);
  });




  it('reads an old store’s pending entry as a question', () => {
    // Every pending entry in an older store WAS a question; that is what the
    // field meant. Anything else would invent an approval nobody asked for.
    const { store } = parseStore(
      JSON.stringify({ '1': { turns: [], pending: { request: 'r', question: 'q', at: 1 } } }),
    );
    expect(store['1']?.pending?.kind).toBe('question');
    expect(store['1']?.pending?.spec).toBeUndefined();
  });

  it('tracks and clears a pending question', () => {
    const memory = new Memory(store());
    expect(memory.pending(1)).toBeNull();
    memory.await_(1, 'la demande', 'la question');
    expect(memory.pending(1)).toMatchObject({ request: 'la demande', question: 'la question' });
    memory.resolve(1);
    expect(memory.pending(1)).toBeNull();
  });

  it('reports what /reset dropped', () => {
    const memory = new Memory(store());
    memory.record(1, 'human', 'un');
    memory.record(1, 'bot', 'deux');
    memory.await_(1, 'r', 'q');
    expect(memory.reset(1)).toEqual({ turns: 2, hadPending: true });
    expect(memory.turns(1)).toEqual([]);
    expect(memory.pending(1)).toBeNull();
  });

  it('renders a transcript the router can read', () => {
    const memory = new Memory(store());
    memory.record(1, 'human', 'comment le score marche ?');
    memory.record(1, 'bot', 'dix points par victoire');
    expect(memory.transcript(1)).toBe(
      'Humain: comment le score marche ?\nBot: dix points par victoire',
    );
  });

  it('has an empty transcript when there is nothing to say', () => {
    expect(new Memory(store()).transcript(1)).toBe('');
  });

  it('truncates a message rather than storing something unbounded', () => {
    const memory = new Memory(store());
    memory.record(1, 'human', 'x'.repeat(5_000));
    expect(memory.turns(1)[0]?.text.length).toBe(1_500);
  });

  it('writes a file that parses back', () => {
    const path = store();
    const memory = new Memory(path);
    memory.record(1, 'human', 'écrit');
    expect(parseStore(readFileSync(path, 'utf8')).recovered).toBe(true);
  });
});

describe('parseStore', () => {
  it('rejects what is not an object', () => {
    for (const raw of ['[]', '"chaîne"', '42', 'null', 'pas du json']) {
      expect(parseStore(raw)).toEqual({ store: {}, recovered: false });
    }
  });

  it('drops turns of the wrong shape instead of failing on them', () => {
    const raw = JSON.stringify({
      '1': { turns: [{ who: 'human', text: 'bon' }, { who: 'martien', text: 'mauvais' }, 42], pending: null },
    });
    const { store, recovered } = parseStore(raw);
    expect(recovered).toBe(true);
    expect(store['1']?.turns.map((t) => t.text)).toEqual(['bon']);
  });

  it('drops a pending entry missing its request', () => {
    const raw = JSON.stringify({ '1': { turns: [], pending: { question: 'seule' } } });
    expect(parseStore(raw).store['1']?.pending).toBeNull();
  });

  it('caps an over-long history read from disk', () => {
    const turns = Array.from({ length: 50 }, (_, i) => ({ at: i, who: 'human', text: `t${i}` }));
    const { store } = parseStore(JSON.stringify({ '1': { turns, pending: null } }));
    expect(store['1']?.turns).toHaveLength(MAX_TURNS);
    expect(store['1']?.turns[0]?.text).toBe('t30');
  });
});
