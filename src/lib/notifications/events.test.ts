import { describe, expect, it } from 'vitest';

import { buildNotifications, type NotifyContext } from './events';

const ctx: NotifyContext = {
  matchId: 'm1',
  gameName: 'Palet',
  gameIcon: '🥏',
  actorId: 'alice',
  actorName: 'Alice',
  participants: [
    { userId: 'alice', sideIndex: 1 },
    { userId: 'bob', sideIndex: 2 },
    { userId: 'ben', sideIndex: 2 },
  ],
  sideLabels: { 1: 'Alice', 2: 'Bob & Ben' },
  adminIds: ['root'],
};

describe('notification recipients', () => {
  it('never notifies the person who caused the event', () => {
    const intents = buildNotifications({ kind: 'match_started' }, ctx);
    expect(intents.map((i) => i.userId)).toEqual(['bob', 'ben']);
  });

  it('notifies only the invited players on an invitation', () => {
    const intents = buildNotifications(
      { kind: 'invitation_received', invitedUserIds: ['bob', 'ben'] },
      ctx,
    );
    expect(intents.map((i) => i.userId)).toEqual(['bob', 'ben']);
    expect(intents[0]?.title).toContain('Alice');
    expect(intents[0]?.body).toContain('5 minutes');
  });

  it('deep-links to the match, not to the home page', () => {
    const intents = buildNotifications(
      { kind: 'invitation_received', invitedUserIds: ['bob'] },
      ctx,
    );
    expect(intents[0]?.url).toBe('/matches/m1');
  });

  it('asks only the sides that owe validation', () => {
    const intents = buildNotifications(
      { kind: 'result_reported', winningSide: 1, sidesOwingValidation: [2] },
      ctx,
    );
    expect(intents.map((i) => i.userId)).toEqual(['bob', 'ben']);
    expect(intents[0]?.body).toContain('Alice');
  });

  it('tells each winner how many points they got', () => {
    const intents = buildNotifications(
      {
        kind: 'result_validated',
        winningSide: 1,
        pointsByUser: { alice: 21 },
      },
      { ...ctx, actorId: 'bob' },
    );
    const alice = intents.find((i) => i.userId === 'alice');
    const ben = intents.find((i) => i.userId === 'ben');
    expect(alice?.body).toContain('+21 pts');
    expect(ben?.body).not.toContain('+');
  });

  it('notifies the validator too, since the award is news to them', () => {
    const intents = buildNotifications(
      { kind: 'result_validated', winningSide: 1, pointsByUser: {} },
      { ...ctx, actorId: 'bob' },
    );
    expect(intents.map((i) => i.userId)).toContain('bob');
  });

  it('routes a dispute to the admins and to the reporter', () => {
    const intents = buildNotifications(
      { kind: 'result_disputed', reason: 'j’ai gagné', reporterId: 'alice' },
      { ...ctx, actorId: 'bob', actorName: 'Bob' },
    );
    expect(intents.map((i) => i.userId).sort()).toEqual(['alice', 'root']);
    expect(intents[0]?.body).toContain('j’ai gagné');
  });

  it('tells everyone a cancelled match scores nothing', () => {
    const intents = buildNotifications(
      { kind: 'match_cancelled', reason: 'plus envie' },
      ctx,
    );
    expect(intents[0]?.body).toContain('Personne ne marque');
    expect(intents[0]?.body).toContain('plus envie');
  });

  it('reports an expired invitation to everyone but the actor', () => {
    const intents = buildNotifications({ kind: 'invitation_expired' }, {
      ...ctx,
      actorId: null,
    });
    expect(intents).toHaveLength(3);
  });

  it('says which way an admin resolved a dispute', () => {
    const completed = buildNotifications(
      { kind: 'dispute_resolved', outcome: 'completed' },
      { ...ctx, actorId: 'root' },
    );
    const cancelled = buildNotifications(
      { kind: 'dispute_resolved', outcome: 'cancelled' },
      { ...ctx, actorId: 'root' },
    );
    expect(completed[0]?.body).toContain('points attribués');
    expect(cancelled[0]?.body).toContain('annulée');
  });
});
