CREATE TABLE `team_point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`match_id` text NOT NULL,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`detail` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `team_point_events_team_idx` ON `team_point_events` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_point_events_match_idx` ON `team_point_events` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_point_events_once` ON `team_point_events` (`match_id`,`team_id`,`type`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`accent` text NOT NULL,
	`captain_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`captain_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_unique` ON `teams` (`slug`);--> statement-breakpoint
ALTER TABLE `users` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
--
-- The two teams (spec 0017, rule 8 and Data model).
--
-- Inserted HERE, with a NULL captain, and not by the seeder: the deploy
-- migrates and never seeds, so the rows have to exist before anybody can
-- choose. The captain is the other way round — `foreign_keys` is ON and this
-- runs against an empty `users` table on a fresh database, so naming a player
-- here would fail with FOREIGN KEY constraint failed every single time. The
-- seeder fills `captain_id` in once the players exist.
--
INSERT OR IGNORE INTO `teams` (`id`, `slug`, `name`, `accent`, `captain_id`, `created_at`)
VALUES ('team-julien', 'julien', 'Équipe Julien', 'coral', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000);--> statement-breakpoint
INSERT OR IGNORE INTO `teams` (`id`, `slug`, `name`, `accent`, `captain_id`, `created_at`)
VALUES ('team-pierre', 'pierre', 'Équipe Pierre', 'sky', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000);
