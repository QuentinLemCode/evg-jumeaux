import { describe, expect, it } from 'vitest';

import { deliveryFor, topicFor } from './delivery';
import type { NotificationIntent, NotificationType } from './events';

function intent(
  type: NotificationType,
  matchId: string | null = '3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708',
): NotificationIntent {
  return { userId: 'bob', type, title: 't', body: 'b', url: '/matches/x', matchId };
}

describe('topicFor', () => {
  it('stays inside the 32-character header limit', () => {
    const topic = topicFor('3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708');
    expect(topic).toBeDefined();
    expect((topic as string).length).toBeLessThanOrEqual(32);
  });

  it('uses only URL-safe characters', () => {
    expect(topicFor('3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is stable for a match, so a newer push replaces an undelivered one', () => {
    const id = '3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708';
    expect(topicFor(id)).toBe(topicFor(id));
  });

  it('differs between matches', () => {
    expect(topicFor('aaaaaaaa-1111-2222-3333-444444444444')).not.toBe(
      topicFor('bbbbbbbb-1111-2222-3333-444444444444'),
    );
  });

  it('is absent when there is no match to collapse on', () => {
    expect(topicFor(null)).toBeUndefined();
  });
});

describe('deliveryFor', () => {
  it('wakes a sleeping phone for an invitation', () => {
    const policy = deliveryFor(intent('invitation_received'));
    expect(policy.urgency).toBe('high');
  });

  it('never outlives the invitation window it is about', () => {
    // The whole failure this prevents: web-push defaults to four weeks, so a
    // phone reconnecting the next morning buzzed for a dead invitation.
    const policy = deliveryFor(intent('invitation_received'));
    expect(policy.ttlSeconds).toBeLessThanOrEqual(10 * 60);
  });

  it('wakes a sleeping phone when somebody is waiting on a validation', () => {
    expect(deliveryFor(intent('result_reported')).urgency).toBe('high');
    expect(deliveryFor(intent('result_disputed')).urgency).toBe('high');
  });

  it('does not spend battery on information', () => {
    for (const type of [
      'match_started',
      'invitation_declined',
      'invitation_expired',
      'match_cancelled',
      'result_validated',
      'dispute_resolved',
    ] as const) {
      expect(deliveryFor(intent(type)).urgency).toBe('normal');
    }
  });

  it('keeps the points around long enough to be read', () => {
    expect(deliveryFor(intent('result_validated')).ttlSeconds).toBeGreaterThanOrEqual(3600);
  });

  it('drops information about a window that has already closed', () => {
    expect(deliveryFor(intent('match_started')).ttlSeconds).toBeLessThanOrEqual(10 * 60);
    expect(deliveryFor(intent('invitation_expired')).ttlSeconds).toBeLessThanOrEqual(30 * 60);
  });

  it('collapses every event of a match onto one topic', () => {
    const id = 'aaaaaaaa-1111-2222-3333-444444444444';
    const a = deliveryFor(intent('invitation_received', id));
    const b = deliveryFor(intent('result_reported', id));
    // A phone that slept through both wakes to the current state, not to a
    // stack of stale banners.
    expect(a.topic).toBe(b.topic);
  });

  it('sets no topic for a notification with no match', () => {
    expect(deliveryFor(intent('result_validated', null)).topic).toBeUndefined();
  });
});
