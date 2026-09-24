/**
 * Per-event delivery policy for Web Push (spec 0006, rules 12-14).
 *
 * The three headers that decide what a SLEEPING phone experiences, and which
 * every one of them gets wrong by default:
 *
 *  - `TTL` — how long the push service holds an undelivered message.
 *    web-push defaults to FOUR WEEKS. An invitation that expires in five
 *    minutes must not buzz somebody's phone the next morning.
 *  - `Urgency` — Android's Doze mode defers `normal` messages until the device
 *    next wakes on its own, which can be many minutes. A five-minute deadline
 *    needs `high`, which wakes the radio immediately. Reserve it for what is
 *    genuinely time-critical: every high-urgency push costs battery, and a
 *    browser that sees them abused can throttle the origin.
 *  - `Topic` — lets the push service REPLACE an undelivered message with a
 *    newer one on the same topic. Without it, a phone offline for twenty
 *    minutes wakes to a stack of stale banners for a match that is already
 *    over; with it, it wakes to the current state and nothing else.
 */
import type { NotificationIntent, NotificationType } from './events';

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export type DeliveryPolicy = {
  /** Seconds the push service may hold this message. */
  ttlSeconds: number;
  urgency: PushUrgency;
  /** URL-safe, at most 32 characters, or undefined for no collapsing. */
  topic?: string;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Time-critical events get `high` urgency and a TTL matched to the deadline
 * they are about; everything else is informational and may wait.
 */
const POLICIES: Record<NotificationType, { ttlSeconds: number; urgency: PushUrgency }> = {
  // The 5-minute invitation window is the whole reason push exists here. A
  // slightly longer TTL than the window itself, so a phone that reconnects at
  // 4 min 50 s still gets a usable invitation.
  invitation_received: { ttlSeconds: 6 * MINUTE, urgency: 'high' },
  // Someone is standing there waiting for this validation.
  result_reported: { ttlSeconds: 12 * HOUR, urgency: 'high' },
  // An admin needs to arbitrate before anybody scores.
  result_disputed: { ttlSeconds: 12 * HOUR, urgency: 'high' },
  // Pure information about a window that has already closed: pointless later.
  match_started: { ttlSeconds: 6 * MINUTE, urgency: 'normal' },
  invitation_declined: { ttlSeconds: 10 * MINUTE, urgency: 'normal' },
  invitation_expired: { ttlSeconds: 10 * MINUTE, urgency: 'normal' },
  match_cancelled: { ttlSeconds: 30 * MINUTE, urgency: 'normal' },
  // Fifteen people are being called to the same table at the same moment,
  // which is the most time-critical thing this app does (spec 0006, rules
  // 12-13). Ten minutes, because a phone that wakes an hour later is being
  // told to come to a match that is over.
  clash_started: { ttlSeconds: 10 * MINUTE, urgency: 'high' },
  // Worth arriving late: it is the points.
  result_validated: { ttlSeconds: 12 * HOUR, urgency: 'normal' },
  dispute_resolved: { ttlSeconds: 12 * HOUR, urgency: 'normal' },
  // A result like any other.
  clash_finished: { ttlSeconds: 12 * HOUR, urgency: 'normal' },
  // Not time-critical — the weekend has not started — but it must still
  // arrive: it is how a player who never opened the choice screen learns
  // which team they are in (spec 0017, rule 15).
  team_assigned: { ttlSeconds: 12 * HOUR, urgency: 'normal' },
};

/**
 * One topic per match, deliberately NOT per event type: through an
 * invitation → started → reported sequence, a phone that was asleep should
 * wake to the current state, not to the history of it.
 *
 * The header allows at most 32 URL-safe characters, and a UUID with its
 * dashes is 36 — hence the strip and the truncation. 28 hex characters is
 * still 112 bits, so two live matches cannot collide.
 */
export function topicFor(matchId: string | null): string | undefined {
  if (!matchId) return undefined;
  const compact = matchId.replace(/[^A-Za-z0-9]/g, '').slice(0, 28);
  return compact.length > 0 ? `m${compact}` : undefined;
}

export function deliveryFor(intent: NotificationIntent): DeliveryPolicy {
  const policy = POLICIES[intent.type] ?? { ttlSeconds: 30 * MINUTE, urgency: 'normal' };
  return { ...policy, topic: topicFor(intent.matchId) };
}
