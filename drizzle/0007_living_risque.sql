CREATE TABLE `dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`widgets` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dashboards_owner` ON `dashboards` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `monitor_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`recovered_at` integer,
	`acknowledged_at` integer,
	`muted_until` integer,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_monitor_event_active` ON `monitor_events` (`resource_id`,`kind`) WHERE "monitor_events"."recovered_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_monitor_event_owner` ON `monitor_events` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `monitor_samples` (
	`resource_id` text NOT NULL,
	`user_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`quality` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`resource_id`, `timestamp`),
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_monitor_owner` ON `monitor_samples` (`user_id`,`timestamp`);