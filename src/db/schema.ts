import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// All timestamps are integer Unix milliseconds (AGENTS.md §5). SQLite has no
// date type worth using, and storing strings makes every comparison a bug
// waiting to happen.
const timestamp = (name: string) => integer(name, { mode: 'number' });

/**
 * Players. Seeded from `src/db/seed/users.ts` and never created at runtime:
 * there is no sign-up endpoint (spec 0002).
 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull(),
  pinHash: text('pin_hash').notNull(),
  avatar: text('avatar').notNull(),
  createdAt: timestamp('created_at').notNull(),
});

/**
 * A game *type* ("Palet"), not an instance of one (spec 0003).
 */
export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon').notNull(),
    mode: text('mode', { enum: ['duel', 'team'] }).notNull(),
    sidesCount: integer('sides_count').notNull(),
    playersPerSide: integer('players_per_side').notNull(),
    pointsPerWin: integer('points_per_win').notNull(),
    marginBonusEnabled: integer('margin_bonus_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    marginBonusPerPoint: integer('margin_bonus_per_point').notNull().default(0),
    marginBonusCap: integer('margin_bonus_cap'),
    requiresScore: integer('requires_score', { mode: 'boolean' })
      .notNull()
      .default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    // Names are unique case-insensitively (spec 0003, rule 7). Enforced in the
    // database rather than only in the action, so a race between two admins
    // creating "Palet" and "palet" cannot produce two games.
    uniqueIndex('games_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

/**
 * One instance of a game.
 *
 * The `rule*` columns are a snapshot of the game's scoring rules taken at
 * creation time. Awarding reads them and never reads `games`, so an admin
 * editing a game mid-weekend cannot retroactively rewrite the leaderboard
 * (spec 0005, rules 13-14).
 */
export const matches = sqliteTable(
  'matches',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    status: text('status', {
      enum: [
        'pending',
        'active',
        'awaiting_validation',
        'disputed',
        'completed',
        'cancelled',
        'expired',
      ],
    }).notNull(),
    invitationExpiresAt: timestamp('invitation_expires_at').notNull(),

    rulePointsPerWin: integer('rule_points_per_win').notNull(),
    ruleMarginBonusPerPoint: integer('rule_margin_bonus_per_point')
      .notNull()
      .default(0),
    ruleMarginBonusCap: integer('rule_margin_bonus_cap'),
    ruleRequiresScore: integer('rule_requires_score', { mode: 'boolean' })
      .notNull()
      .default(false),

    winningSide: integer('winning_side'),
    reportedBy: text('reported_by').references(() => users.id),
    reportedAt: timestamp('reported_at'),
    settledAt: timestamp('settled_at'),
    settledBy: text('settled_by').references(() => users.id),
    cancelledBy: text('cancelled_by').references(() => users.id),
    /**
     * The admin who force-expired a pending invitation, if one did. Null when
     * the background sweep expired it on schedule — which is why "who killed
     * my invitation?" is answerable (spec 0008, rule 18).
     */
    forcedBy: text('forced_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    disputeReason: text('dispute_reason'),
    disputedBy: text('disputed_by').references(() => users.id),
    /**
     * The admin's stated reason for settling a dispute. Distinct from
     * `disputeReason`, which is the player's complaint. Required when an admin
     * arbitrates: an arbitration with no stated reason is exactly what the
     * public log exists to prevent (spec 0008, rule 3).
     */
    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('matches_status_idx').on(t.status),
    index('matches_created_at_idx').on(t.createdAt),
  ],
);

/**
 * A side of a match: a team in a team game, a single player in a duel.
 */
export const matchSides = sqliteTable(
  'match_sides',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    sideIndex: integer('side_index').notNull(),
    label: text('label').notNull(),
    score: integer('score'),
    validatedAt: timestamp('validated_at'),
    validatedBy: text('validated_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.sideIndex] })],
);

export const matchParticipants = sqliteTable(
  'match_participants',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sideIndex: integer('side_index').notNull(),
    invitationStatus: text('invitation_status', {
      enum: ['pending', 'accepted', 'declined'],
    }).notNull(),
    respondedAt: timestamp('responded_at'),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.userId] }),
    // The busy check (spec 0004, rule 7) queries by user across non-terminal
    // matches, and runs on every screen that lists opponents.
    index('match_participants_user_idx').on(t.userId),
  ],
);

/**
 * The point ledger — append-only and immutable (spec 0005).
 *
 * Every total displayed in the app is a SUM over this table. There is
 * deliberately no `users.points` column: a mutable total cannot be audited,
 * and the product requires that the margin bonus be itemised line by line.
 */
export const pointEvents = sqliteTable(
  'point_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    matchId: text('match_id').references(() => matches.id),
    type: text('type', {
      enum: ['match_win', 'margin_bonus', 'admin_adjustment', 'match_reversal'],
    }).notNull(),
    /** Signed. Negative for reversals and for downward admin adjustments. */
    points: integer('points').notNull(),
    /** Human-readable arithmetic, in French, shown in the history. */
    detail: text('detail').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('point_events_user_idx').on(t.userId),
    index('point_events_match_idx').on(t.matchId),
    // Makes awarding idempotent by construction rather than by trusting the
    // caller (spec 0005, rule 7).
    unique('point_events_once').on(t.matchId, t.userId, t.type),
  ],
);

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failures: integer('failures').notNull().default(0),
    createdAt: timestamp('created_at').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url').notNull(),
    matchId: text('match_id').references(() => matches.id),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type MatchSideRow = typeof matchSides.$inferSelect;
export type MatchParticipantRow = typeof matchParticipants.$inferSelect;
export type PointEventRow = typeof pointEvents.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
