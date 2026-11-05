CREATE TABLE `card_definitions` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`manifest` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `card_states` (
	`board_id` text NOT NULL,
	`widget_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`board_id`, `widget_id`),
	FOREIGN KEY (`board_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE cascade
);
