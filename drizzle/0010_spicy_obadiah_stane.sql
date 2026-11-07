CREATE TABLE `database_credentials` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_database_credentials_user` ON `database_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `resources` ADD `site_icon_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `database_config` text DEFAULT '{}' NOT NULL;