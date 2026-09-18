CREATE TABLE `client_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`path` text NOT NULL,
	`app_commit` text,
	`viewport` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_user_id` text,
	`last_user_agent` text,
	`last_browser` text,
	`resolved_at` integer,
	`alerted_at` integer,
	FOREIGN KEY (`last_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_errors_fingerprint_unique` ON `client_errors` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `client_errors_last_seen_idx` ON `client_errors` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `client_errors_resolved_idx` ON `client_errors` (`resolved_at`);