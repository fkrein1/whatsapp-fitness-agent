CREATE TABLE `record_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text NOT NULL,
	`after` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `fitness_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `record_changes_event_created_at_idx` ON `record_changes` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `record_changes_source_message_id_idx` ON `record_changes` (`source_message_id`);--> statement-breakpoint
ALTER TABLE `fitness_events` ADD `updated_at` integer;--> statement-breakpoint
ALTER TABLE `fitness_events` ADD `deleted_at` integer;