import { describe, expect, it } from 'vitest';

import {
  canAct,
  initialStatus,
  isInvitationExpired,
  sidesOwingValidation,
  startsAccepted,
  transition,
  type MatchAction,
} from './match-state';
import { INVITATION_TTL_MS, type MatchSnapshot, type MatchStatus } from './types';

const NOW = 1_700_000_000_000;

function duel(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    id: 'm1',
    status: 'pending',
    sidesCount: 2,
    invitationExpiresAt: NOW + INVITATION_TTL_MS,
    requiresScore: true,
    createdBy: 'alice',
    reportedBy: null,
    winningSide: null,
    participants: [
      { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
      { userId: 'bob', sideIndex: 2, invitationStatus: 'pending' },
    ],
    sides: [
      { sideIndex: 1, score: null, validatedAt: null },
      { sideIndex: 2, score: null, validatedAt: null },
    ],
    ...overrides,
  };
}

function teamMatch(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return duel({
    participants: [
      { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
      { userId: 'anna', sideIndex: 1, invitationStatus: 'pending' },
      { userId: 'bob', sideIndex: 2, invitationStatus: 'pending' },
      { userId: 'ben', sideIndex: 2, invitationStatus: 'pending' },
    ],
    ...overrides,
  });
}

function reported(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return duel({
    status: 'awaiting_validation',
    reportedBy: 'alice',
    winningSide: 1,
    participants: [
      { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
      { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
    ],
    sides: [
      { sideIndex: 1, score: 13, validatedAt: null },
      { sideIndex: 2, score: 2, validatedAt: null },
    ],
    ...overrides,
  });
}

describe('invitation expiry', () => {
  it('is not expired before the deadline', () => {
    expect(isInvitationExpired(duel(), NOW)).toBe(false);
  });

  it('is expired at the deadline exactly', () => {
    expect(isInvitationExpired(duel(), NOW + INVITATION_TTL_MS)).toBe(true);
  });

  it('only applies to pending matches', () => {
    const active = duel({ status: 'active' });
    expect(isInvitationExpired(active, NOW + INVITATION_TTL_MS * 10)).toBe(false);
  });

  it('expires a pending match past its deadline', () => {
    const result = transition(duel(), { type: 'expire' }, NOW + INVITATION_TTL_MS);
    expect(result).toMatchObject({ ok: true, nextStatus: 'expired' });
  });

  it('refuses to expire a match that is still in time', () => {
    const result = transition(duel(), { type: 'expire' }, NOW);
    expect(result).toMatchObject({ ok: false, code: 'not_expired_yet' });
  });

  it('records nothing when the background sweep expires it', () => {
    const result = transition(duel(), { type: 'expire' }, NOW + INVITATION_TTL_MS);
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toEqual([]);
  });

  it('records the admin when one force-expires it by hand', () => {
    const result = transition(
      duel(),
      { type: 'expire', byUserId: 'root' },
      NOW + INVITATION_TTL_MS,
    );
    expect(result).toMatchObject({ ok: true, nextStatus: 'expired' });
    if (!result.ok) throw new Error('unreachable');
    // Killing someone's invitation is an intervention, so it must be
    // attributable in the public log (spec 0008, rule 18).
    expect(result.effects).toContainEqual({ kind: 'force-expire', byUserId: 'root' });
  });
});

describe('accepting an invitation', () => {
  it('activates the match when the last invitation is accepted', () => {
    const result = transition(duel(), { type: 'accept', userId: 'bob' }, NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'active' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toContainEqual({
      kind: 'set-invitation',
      userId: 'bob',
      status: 'accepted',
    });
    // Nothing is awarded when a match merely starts (spec 0004, criterion).
    expect(result.effects.some((e) => e.kind === 'award-points')).toBe(false);
  });

  it('stays pending while other invitations are outstanding', () => {
    const result = transition(teamMatch(), { type: 'accept', userId: 'bob' }, NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'pending' });
  });

  it('activates a team match only once everyone accepted', () => {
    const almost = teamMatch({
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'anna', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
        { userId: 'ben', sideIndex: 2, invitationStatus: 'pending' },
      ],
    });
    expect(transition(almost, { type: 'accept', userId: 'ben' }, NOW)).toMatchObject({
      ok: true,
      nextStatus: 'active',
    });
  });

  it('rejects accepting after the deadline', () => {
    const result = transition(
      duel(),
      { type: 'accept', userId: 'bob' },
      NOW + INVITATION_TTL_MS,
    );
    expect(result).toMatchObject({ ok: false, code: 'invitation_expired' });
  });

  it('rejects a stranger', () => {
    expect(transition(duel(), { type: 'accept', userId: 'carol' }, NOW)).toMatchObject({
      ok: false,
      code: 'not_a_participant',
    });
  });

  it('is a no-op error when accepting twice', () => {
    expect(transition(duel(), { type: 'accept', userId: 'alice' }, NOW)).toMatchObject({
      ok: false,
      code: 'invitation_already_answered',
    });
  });
});

describe('declining an invitation', () => {
  it('cancels the whole match on a single refusal', () => {
    const result = transition(teamMatch(), { type: 'decline', userId: 'ben' }, NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'cancelled' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toContainEqual({
      kind: 'set-invitation',
      userId: 'ben',
      status: 'declined',
    });
  });
});

/**
 * A clash has no invitation phase at all (spec 0017, rules 4-5): an admin
 * calls it, everybody is in, and it is `active` from the first millisecond.
 *
 * That is why neither `decline` nor `expire` carries a special case for it —
 * a clash is never `pending`, so neither transition can ever see one.
 */
describe('how a match starts', () => {
  it('leaves a duel and a team game pending, with only the creator accepted', () => {
    for (const mode of ['duel', 'team'] as const) {
      expect(initialStatus(mode)).toBe('pending');
      expect(startsAccepted(mode, 'alice', 'alice')).toBe(true);
      expect(startsAccepted(mode, 'bob', 'alice')).toBe(false);
    }
  });

  it('starts a clash active, with every participant accepted', () => {
    expect(initialStatus('clash')).toBe('active');
    expect(startsAccepted('clash', 'alice', 'alice')).toBe(true);
    expect(startsAccepted('clash', 'bob', 'alice')).toBe(true);
    expect(startsAccepted('clash', 'ben', 'alice')).toBe(true);
  });
});

describe('reporting a result', () => {
  const active = () =>
    duel({
      status: 'active',
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
      ],
    });

  const report = (
    winningSide: number,
    scores: { sideIndex: number; score: number }[],
    userId = 'alice',
  ): MatchAction => ({ type: 'report', userId, winningSide, scores });

  it('moves to awaiting_validation and awards nothing yet', () => {
    const result = transition(
      active(),
      report(1, [
        { sideIndex: 1, score: 13 },
        { sideIndex: 2, score: 2 },
      ]),
      NOW,
    );
    expect(result).toMatchObject({ ok: true, nextStatus: 'awaiting_validation' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects.some((e) => e.kind === 'award-points')).toBe(false);
    expect(result.effects).toContainEqual({ kind: 'set-winning-side', sideIndex: 1 });
  });

  it('lets a losing player report — validation is what matters, not reporting', () => {
    const result = transition(
      active(),
      report(
        1,
        [
          { sideIndex: 1, score: 13 },
          { sideIndex: 2, score: 2 },
        ],
        'bob',
      ),
      NOW,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a winning side that does not have the highest score', () => {
    expect(
      transition(
        active(),
        report(2, [
          { sideIndex: 1, score: 13 },
          { sideIndex: 2, score: 2 },
        ]),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'inconsistent_scores' });
  });

  it('rejects a draw', () => {
    expect(
      transition(
        active(),
        report(1, [
          { sideIndex: 1, score: 7 },
          { sideIndex: 2, score: 7 },
        ]),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'inconsistent_scores' });
  });

  it('rejects a missing score when the game requires one', () => {
    expect(
      transition(active(), report(1, [{ sideIndex: 1, score: 13 }]), NOW),
    ).toMatchObject({ ok: false, code: 'missing_scores' });
  });

  it('rejects a negative score', () => {
    expect(
      transition(
        active(),
        report(1, [
          { sideIndex: 1, score: 13 },
          { sideIndex: 2, score: -1 },
        ]),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'inconsistent_scores' });
  });

  it('accepts a report with no scores when the game does not require them', () => {
    const scoreless = duel({
      status: 'active',
      requiresScore: false,
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
      ],
    });
    const result = transition(scoreless, report(2, []), NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'awaiting_validation' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects.some((e) => e.kind === 'set-scores')).toBe(false);
  });

  it('rejects an unknown side', () => {
    expect(transition(active(), report(3, []), NOW)).toMatchObject({
      ok: false,
      code: 'invalid_winning_side',
    });
  });

  it('tells the second concurrent reporter the result is already in', () => {
    expect(
      transition(reported(), report(1, [{ sideIndex: 1, score: 1 }]), NOW),
    ).toMatchObject({ ok: false, code: 'already_reported' });
  });
});

describe('validating a result', () => {
  it('owes validation to every side except the reporter’s', () => {
    expect(sidesOwingValidation(reported())).toEqual([2]);
  });

  it('completes the match and awards points on the last validation', () => {
    const result = transition(reported(), { type: 'validate', userId: 'bob' }, NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'completed' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toContainEqual({ kind: 'award-points' });
  });

  it('refuses a validation from the reporter’s own side', () => {
    expect(transition(reported(), { type: 'validate', userId: 'alice' }, NOW)).toMatchObject({
      ok: false,
      code: 'own_side_cannot_validate',
    });
  });

  it('refuses a second validation from the same side', () => {
    const already = reported({
      sides: [
        { sideIndex: 1, score: 13, validatedAt: null },
        { sideIndex: 2, score: 2, validatedAt: NOW },
      ],
    });
    expect(transition(already, { type: 'validate', userId: 'bob' }, NOW)).toMatchObject({
      ok: false,
      code: 'side_already_validated',
    });
  });

  it('requires every non-reporting side to validate in a 3-side match', () => {
    const threeSides = duel({
      status: 'awaiting_validation',
      sidesCount: 3,
      reportedBy: 'alice',
      winningSide: 1,
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
        { userId: 'carol', sideIndex: 3, invitationStatus: 'accepted' },
      ],
      sides: [
        { sideIndex: 1, score: 13, validatedAt: null },
        { sideIndex: 2, score: 7, validatedAt: null },
        { sideIndex: 3, score: 4, validatedAt: null },
      ],
    });

    const first = transition(threeSides, { type: 'validate', userId: 'bob' }, NOW);
    expect(first).toMatchObject({ ok: true, nextStatus: 'awaiting_validation' });

    const afterFirst = {
      ...threeSides,
      sides: threeSides.sides.map((s) =>
        s.sideIndex === 2 ? { ...s, validatedAt: NOW } : s,
      ),
    };
    expect(transition(afterFirst, { type: 'validate', userId: 'carol' }, NOW)).toMatchObject({
      ok: true,
      nextStatus: 'completed',
    });
  });

  it('refuses a stranger', () => {
    expect(transition(reported(), { type: 'validate', userId: 'zoe' }, NOW)).toMatchObject({
      ok: false,
      code: 'not_a_participant',
    });
  });
});

describe('disputing a result', () => {
  it('moves to disputed and awards nothing', () => {
    const result = transition(
      reported(),
      { type: 'dispute', userId: 'bob', reason: 'j’ai gagné' },
      NOW,
    );
    expect(result).toMatchObject({ ok: true, nextStatus: 'disputed' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects.some((e) => e.kind === 'award-points')).toBe(false);
  });

  it('cannot be raised by the reporter’s own side', () => {
    expect(
      transition(reported(), { type: 'dispute', userId: 'alice', reason: null }, NOW),
    ).toMatchObject({ ok: false, code: 'own_side_cannot_validate' });
  });
});

describe('cancelling', () => {
  const cancel = (userId: string, isAdmin = false): MatchAction => ({
    type: 'cancel',
    userId,
    isAdmin,
    reason: null,
  });

  it('lets a participant cancel a pending match', () => {
    expect(transition(duel(), cancel('bob'), NOW)).toMatchObject({
      ok: true,
      nextStatus: 'cancelled',
    });
  });

  it('lets a participant cancel an active match', () => {
    expect(transition(duel({ status: 'active' }), cancel('bob'), NOW)).toMatchObject({
      ok: true,
      nextStatus: 'cancelled',
    });
  });

  it('refuses a non-participant who is not an admin', () => {
    expect(transition(duel(), cancel('zoe'), NOW)).toMatchObject({
      ok: false,
      code: 'not_a_participant',
    });
  });

  it('refuses a participant once a result is awaiting validation', () => {
    expect(transition(reported(), cancel('bob'), NOW)).toMatchObject({
      ok: false,
      code: 'admin_only',
    });
  });

  it('lets an admin cancel an awaiting_validation match', () => {
    expect(transition(reported(), cancel('root', true), NOW)).toMatchObject({
      ok: true,
      nextStatus: 'cancelled',
    });
  });

  it('reverses the points when an admin cancels a completed match', () => {
    const done = reported({ status: 'completed' });
    const result = transition(done, cancel('root', true), NOW);
    expect(result).toMatchObject({ ok: true, nextStatus: 'cancelled' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toContainEqual({ kind: 'reverse-points' });
  });

  it('refuses a participant on a completed match', () => {
    expect(transition(reported({ status: 'completed' }), cancel('bob'), NOW)).toMatchObject({
      ok: false,
      code: 'admin_only',
    });
  });

  it('refuses to cancel an already cancelled match', () => {
    expect(
      transition(duel({ status: 'cancelled' }), cancel('root', true), NOW),
    ).toMatchObject({ ok: false, code: 'wrong_state' });
  });
});

describe('resolving a dispute', () => {
  const disputed = () => reported({ status: 'disputed' });

  it('settles it, awarding points from the admin’s decision', () => {
    const result = transition(
      disputed(),
      {
        type: 'resolve',
        adminId: 'root',
        outcome: {
          kind: 'settle',
          winningSide: 2,
          scores: [
            { sideIndex: 1, score: 5 },
            { sideIndex: 2, score: 13 },
          ],
          note: 'deux témoins confirment le score',
        },
      },
      NOW,
    );
    expect(result).toMatchObject({ ok: true, nextStatus: 'completed' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects).toContainEqual({ kind: 'set-winning-side', sideIndex: 2 });
    expect(result.effects).toContainEqual({ kind: 'award-points' });
    // The admin's stated reason rides along and lands in the public log.
    expect(result.effects).toContainEqual({
      kind: 'settle',
      byUserId: 'root',
      note: 'deux témoins confirment le score',
    });
  });

  it('cancels it, awarding nothing', () => {
    const result = transition(
      disputed(),
      { type: 'resolve', adminId: 'root', outcome: { kind: 'cancel', reason: 'match rejoué' } },
      NOW,
    );
    expect(result).toMatchObject({ ok: true, nextStatus: 'cancelled' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.effects.some((e) => e.kind === 'award-points')).toBe(false);
  });

  it('rejects an inconsistent score, same rule as a player report', () => {
    expect(
      transition(
        disputed(),
        {
          type: 'resolve',
          adminId: 'root',
          outcome: {
            kind: 'settle',
            winningSide: 1,
            scores: [
              { sideIndex: 1, score: 2 },
              { sideIndex: 2, score: 13 },
            ],
            note: 'score incohérent, à rejouer',
          },
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'inconsistent_scores' });
  });

  it('refuses to resolve a match that is not disputed', () => {
    expect(
      transition(
        reported(),
        { type: 'resolve', adminId: 'root', outcome: { kind: 'cancel', reason: 'x' } },
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'wrong_state' });
  });
});

describe('illegal transitions from every state', () => {
  const cases: { status: MatchStatus; action: MatchAction; code: string }[] = [
    { status: 'active', action: { type: 'accept', userId: 'bob' }, code: 'wrong_state' },
    { status: 'completed', action: { type: 'accept', userId: 'bob' }, code: 'wrong_state' },
    { status: 'expired', action: { type: 'accept', userId: 'bob' }, code: 'wrong_state' },
    { status: 'pending', action: { type: 'validate', userId: 'bob' }, code: 'wrong_state' },
    { status: 'cancelled', action: { type: 'validate', userId: 'bob' }, code: 'wrong_state' },
    {
      status: 'pending',
      action: { type: 'report', userId: 'alice', winningSide: 1, scores: [] },
      code: 'wrong_state',
    },
    {
      status: 'disputed',
      action: { type: 'dispute', userId: 'bob', reason: null },
      code: 'wrong_state',
    },
  ];

  it.each(cases)('rejects $action.type from $status', ({ status, action, code }) => {
    const result = transition(duel({ status }), action, NOW);
    expect(result).toMatchObject({ ok: false, code });
    // Nothing is written when a transition is refused.
    expect(result.ok ? result.effects : []).toEqual([]);
  });
});

describe('canAct — what the UI may offer', () => {
  it('offers accept and decline to an invited player', () => {
    expect(canAct(duel(), 'bob', NOW)).toMatchObject({
      canAccept: true,
      canDecline: true,
      canReport: false,
    });
  });

  it('offers nothing to an invited player past the deadline', () => {
    expect(canAct(duel(), 'bob', NOW + INVITATION_TTL_MS)).toMatchObject({
      canAccept: false,
      canDecline: false,
    });
  });

  it('offers validation only to the side that owes it', () => {
    expect(canAct(reported(), 'bob', NOW).canValidate).toBe(true);
    expect(canAct(reported(), 'alice', NOW).canValidate).toBe(false);
  });

  it('offers nothing to a stranger', () => {
    expect(canAct(duel(), 'zoe', NOW)).toEqual({
      canAccept: false,
      canDecline: false,
      canReport: false,
      canValidate: false,
      canCancel: false,
    });
  });

  it('offers nothing to participants on a clash match', () => {
    const clash = duel({
      mode: 'clash',
      status: 'active',
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
      ],
    });
    expect(canAct(clash, 'alice', NOW)).toEqual({
      canAccept: false,
      canDecline: false,
      canReport: false,
      canValidate: false,
      canCancel: false,
    });
  });
});

describe('clash mode — admin-managed lifecycle', () => {
  function activeClash(): MatchSnapshot {
    return duel({
      mode: 'clash',
      status: 'active',
      sidesCount: 2,
      participants: [
        { userId: 'alice', sideIndex: 1, invitationStatus: 'accepted' },
        { userId: 'bob', sideIndex: 2, invitationStatus: 'accepted' },
      ],
      sides: [
        { sideIndex: 1, score: 0, validatedAt: null },
        { sideIndex: 2, score: 0, validatedAt: null },
      ],
    });
  }

  it('rejects player report, validate, and dispute on a clash', () => {
    const match = activeClash();
    expect(
      transition(
        match,
        {
          type: 'report',
          userId: 'alice',
          winningSide: 1,
          scores: [
            { sideIndex: 1, score: 10 },
            { sideIndex: 2, score: 5 },
          ],
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'clash_admin_managed' });

    expect(transition(match, { type: 'validate', userId: 'bob' }, NOW)).toMatchObject({
      ok: false,
      code: 'clash_admin_managed',
    });

    expect(
      transition(match, { type: 'dispute', userId: 'bob', reason: 'nope' }, NOW),
    ).toMatchObject({
      ok: false,
      code: 'clash_admin_managed',
    });
  });

  it('allows admin to update intermediate live scores without ending match', () => {
    const match = activeClash();
    const result = transition(
      match,
      {
        type: 'update-scores',
        adminId: 'admin1',
        scores: [
          { sideIndex: 1, score: 5 },
          { sideIndex: 2, score: 5 },
        ],
      },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      nextStatus: 'active',
      effects: [
        {
          kind: 'set-scores',
          scores: [
            { sideIndex: 1, score: 5 },
            { sideIndex: 2, score: 5 },
          ],
        },
      ],
    });
  });

  it('allows admin to settle clash directly and awards points', () => {
    const match = activeClash();
    const result = transition(
      match,
      {
        type: 'settle-clash',
        adminId: 'admin1',
        winningSide: 1,
        scores: [
          { sideIndex: 1, score: 10 },
          { sideIndex: 2, score: 6 },
        ],
      },
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      nextStatus: 'completed',
      effects: [
        {
          kind: 'set-scores',
          scores: [
            { sideIndex: 1, score: 10 },
            { sideIndex: 2, score: 6 },
          ],
        },
        { kind: 'set-winning-side', sideIndex: 1 },
        { kind: 'settle', byUserId: 'admin1' },
        { kind: 'award-points' },
      ],
    });
  });

  it('rejects clash settlement with inconsistent scores', () => {
    const match = activeClash();
    const result = transition(
      match,
      {
        type: 'settle-clash',
        adminId: 'admin1',
        winningSide: 1,
        scores: [
          { sideIndex: 1, score: 5 },
          { sideIndex: 2, score: 10 },
        ],
      },
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: 'inconsistent_scores' });
  });
});

