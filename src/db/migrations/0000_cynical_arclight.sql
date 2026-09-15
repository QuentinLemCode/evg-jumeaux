CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text NOT NULL,
	`mode` text NOT NULL,
	`sides_count` integer NOT NULL,
	`players_per_side` integer NOT NULL,
	`points_per_win` integer NOT NULL,
	`margin_bonus_enabled` integer DEFAULT false NOT NULL,
	`margin_bonus_per_point` integer DEFAULT 0 NOT NULL,
	`margin_bonus_cap` integer,
	`requires_score` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_slug_unique` ON `games` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_name_lower_idx` ON `games` (lower("name"));--> statement-breakpoint
CREATE TABLE `match_participants` (
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`side_index` integer NOT NULL,
	`invitation_status` text NOT NULL,
	`responded_at` integer,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_participants_user_idx` ON `match_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `match_sides` (
	`match_id` text NOT NULL,
	`side_index` integer NOT NULL,
	`label` text NOT NULL,
	`score` integer,
	`validated_at` integer,
	`validated_by` text,
	PRIMARY KEY(`match_id`, `side_index`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`validated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text NOT NULL,
	`invitation_expires_at` integer NOT NULL,
	`rule_points_per_win` integer NOT NULL,
	`rule_margin_bonus_per_point` integer DEFAULT 0 NOT NULL,
	`rule_margin_bonus_cap` integer,
	`rule_requires_score` integer DEFAULT false NOT NULL,
	`winning_side` integer,
	`reported_by` text,
	`reported_at` integer,
	`settled_at` integer,
	`settled_by` text,
	`cancelled_by` text,
	`cancel_reason` text,
	`dispute_reason` text,
	`disputed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`disputed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_status_idx` ON `matches` (`status`);--> statement-breakpoint
CREATE INDEX `matches_created_at_idx` ON `matches` (`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`match_id` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `point_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`match_id` text,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`detail` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `point_events_user_idx` ON `point_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `point_events_match_idx` ON `point_events` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `point_events_once` ON `point_events` (`match_id`,`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`pin_hash` text NOT NULL,
	`avatar` text NOT NULL,
	`created_at` integer NOT NULL
);
