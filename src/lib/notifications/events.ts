/**
 * Notification content and recipients (spec 0006, rule 7).
 *
 * Pure: an event plus a context produces the exact rows to insert. Keeping it
 * pure means the recipient rules — in particular "never notify the person who
 * caused the event" — are unit-testable without a push service.
 */

export type NotificationType =
  | 'invitation_received'
  | 'match_started'
  | 'invitation_declined'
  | 'invitation_expired'
  | 'result_reported'
  | 'result_validated'
  | 'result_disputed'
  | 'match_cancelled'
  | 'dispute_resolved'
  | 'clash_started'
  | 'clash_finished'
  | 'team_assigned';

export type NotificationIntent = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link straight to where the player can act (spec 0006, rule 8). */
  url: string;
  matchId: string | null;
};

export type NotifyContext = {
  matchId: string;
  gameName: string;
  gameIcon: string;
  /** Who caused the event. They are never notified about it (rule 9). */
  actorId: string | null;
  actorName: string;
  /** Every participant, with the side they are on. */
  participants: { userId: string; sideIndex: number }[];
  /** Side labels, for readable bodies in team games. */
  sideLabels: Record<number, string>;
  adminIds: string[];
};

export type NotificationEvent =
  | { kind: 'invitation_received'; invitedUserIds: string[] }
  | { kind: 'match_started' }
  | { kind: 'invitation_declined' }
  | { kind: 'invitation_expired' }
  | { kind: 'result_reported'; winningSide: number; sidesOwingValidation: number[] }
  | { kind: 'result_validated'; winningSide: number; pointsByUser: Record<string, number> }
  | { kind: 'result_disputed'; reason: string | null; reporterId: string | null }
  | { kind: 'match_cancelled'; reason: string | null }
  | { kind: 'dispute_resolved'; outcome: 'completed' | 'cancelled' }
  // A clash has no invitation, so nothing else would tell the other fourteen
  // guests the set piece has begun (spec 0017, rule 7).
  | { kind: 'clash_started' }
  | { kind: 'clash_finished'; winningSide: number; pointsByUser: Record<string, number> };

function matchUrl(matchId: string): string {
  return `/matches/${matchId}`;
}

/**
 * The players the app placed itself, told which team they are in
 * (spec 0017, rule 15).
 *
 * Its own builder, because it is the one notification that is not about a
 * match: there is no game, no icon and no side, so `NotifyContext` has
 * nothing to offer it. It links to the team screen, where the answer to
 * "who am I with?" actually lives.
 *
 * The player whose choice filled the team is not in this list — the caller
 * excludes them, because they caused the event (spec 0006, rule 9).
 */
export function buildTeamAssignedNotifications(
  assigned: { userId: string; teamName: string }[],
): NotificationIntent[] {
  return assigned.map(({ userId, teamName }) => ({
    userId,
    type: 'team_assigned' as const,
    title: `Tu joues dans l’${teamName}`,
    body: 'L’autre équipe est complète, alors on t’a placé. Bonne chance.',
    url: '/teams',
    matchId: null,
  }));
}

export function buildNotifications(
  event: NotificationEvent,
  ctx: NotifyContext,
): NotificationIntent[] {
  const everyone = ctx.participants.map((p) => p.userId);
  const url = matchUrl(ctx.matchId);
  const icon = ctx.gameIcon;

  const to = (
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
  ): NotificationIntent[] =>
    [...new Set(userIds)]
      // Rule 9: the actor already knows what they just did.
      .filter((userId) => userId !== ctx.actorId)
      .map((userId) => ({ userId, type, title, body, url, matchId: ctx.matchId }));

  switch (event.kind) {
    case 'invitation_received':
      return to(
        event.invitedUserIds,
        'invitation_received',
        `${icon} ${ctx.actorName} te défie !`,
        `${ctx.gameName} — tu as 5 minutes pour accepter.`,
      );

    case 'match_started':
      return to(
        everyone,
        'match_started',
        `${icon} La partie commence`,
        `${ctx.gameName} — tout le monde a accepté. Bonne chance.`,
      );

    case 'invitation_declined':
      return to(
        everyone,
        'invitation_declined',
        `${icon} ${ctx.actorName} a refusé`,
        `La partie de ${ctx.gameName} est annulée.`,
      );

    case 'invitation_expired':
      return to(
        everyone,
        'invitation_expired',
        `${icon} Invitation expirée`,
        `Personne n’a répondu à temps pour la partie de ${ctx.gameName}.`,
      );

    case 'result_reported': {
      const owed = ctx.participants
        .filter((p) => event.sidesOwingValidation.includes(p.sideIndex))
        .map((p) => p.userId);
      const winner = ctx.sideLabels[event.winningSide] ?? `Camp ${event.winningSide}`;
      return to(
        owed,
        'result_reported',
        `${icon} Résultat à valider`,
        `${ctx.actorName} déclare que ${winner} a gagné. À toi de valider.`,
      );
    }

    case 'result_validated': {
      // The only event that also notifies the actor: the points awarded are
      // news to the validator too (spec 0006, rule 7).
      const winner = ctx.sideLabels[event.winningSide] ?? `Camp ${event.winningSide}`;
      return everyone.map((userId) => {
        const points = event.pointsByUser[userId] ?? 0;
        const body =
          points > 0
            ? `${winner} gagne. Tu empoches +${points} pts.`
            : `${winner} gagne la partie de ${ctx.gameName}.`;
        return {
          userId,
          type: 'result_validated' as const,
          title: `${icon} Résultat validé`,
          body,
          url,
          matchId: ctx.matchId,
        };
      });
    }

    case 'result_disputed': {
      const recipients = [...ctx.adminIds];
      if (event.reporterId) recipients.push(event.reporterId);
      const reason = event.reason ? ` « ${event.reason} »` : '';
      return to(
        recipients,
        'result_disputed',
        `${icon} Résultat contesté`,
        `${ctx.actorName} conteste le résultat de ${ctx.gameName}.${reason}`,
      );
    }

    case 'match_cancelled': {
      const reason = event.reason ? ` (${event.reason})` : '';
      return to(
        everyone,
        'match_cancelled',
        `${icon} Partie annulée`,
        `La partie de ${ctx.gameName} est annulée${reason}. Personne ne marque.`,
      );
    }

    case 'dispute_resolved':
      return to(
        everyone,
        'dispute_resolved',
        `${icon} Un admin a tranché`,
        event.outcome === 'completed'
          ? `Le résultat de ${ctx.gameName} a été arbitré et les points attribués.`
          : `La partie de ${ctx.gameName} a été annulée par un admin.`,
      );

    // Everybody except the admin who called it — `to()` drops the actor, and
    // the actor here is that admin (spec 0006, rule 9).
    case 'clash_started': {
      const left = ctx.sideLabels[1] ?? 'Une équipe';
      const right = ctx.sideLabels[2] ?? 'l’autre';
      return to(
        everyone,
        'clash_started',
        `${icon} Le grand match commence !`,
        `${left} contre ${right}. Tout le monde en piste.`,
      );
    }

    // Everybody except whoever validated it. Unlike `result_validated`, which
    // tells the validator too, a clash's result is announced BY them — so the
    // one person who already knows is left out (spec 0017, rule 7).
    case 'clash_finished': {
      const winner = ctx.sideLabels[event.winningSide] ?? `Camp ${event.winningSide}`;
      return everyone
        .filter((userId) => userId !== ctx.actorId)
        .map((userId) => {
          const points = event.pointsByUser[userId] ?? 0;
          return {
            userId,
            type: 'clash_finished' as const,
            title: `${icon} Le grand match est terminé`,
            body:
              points > 0
                ? `${winner} l’emporte. Tu empoches +${points} pts.`
                : `${winner} l’emporte.`,
            url,
            matchId: ctx.matchId,
          };
        });
    }
  }
}
