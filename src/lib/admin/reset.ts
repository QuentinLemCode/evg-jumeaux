import { eq, notInArray } from 'drizzle-orm';

import { db } from '@/db';
import {
  matches,
  matchParticipants,
  matchSides,
  notifications,
  pointEvents,
  teamPointEvents,
  teams,
  users,
} from '@/db/schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Resets the tournament state for kickoff (spec 0008, rules 22-25):
 * - deletes all notifications
 * - deletes all player point events and team point events
 * - deletes all match participants, sides, and matches
 * - resets team_id to NULL for all players except the captains
 * - ensures captains remain on their respective teams
 */
export function performTournamentReset(database: typeof db = db): void {
  database.transaction((tx: Tx) => {
    tx.delete(notifications).run();
    tx.delete(pointEvents).run();
    tx.delete(teamPointEvents).run();
    tx.delete(matchParticipants).run();
    tx.delete(matchSides).run();
    tx.delete(matches).run();

    const teamRows = tx.select({ id: teams.id, captainId: teams.captainId }).from(teams).all();
    const captainIds = teamRows
      .map((t) => t.captainId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (captainIds.length > 0) {
      tx.update(users).set({ teamId: null }).where(notInArray(users.id, captainIds)).run();
      for (const t of teamRows) {
        if (t.captainId) {
          tx.update(users).set({ teamId: t.id }).where(eq(users.id, t.captainId)).run();
        }
      }
    } else {
      tx.update(users).set({ teamId: null }).run();
    }
  });
}
