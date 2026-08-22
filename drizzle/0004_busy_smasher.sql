CREATE TABLE `meal_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`source_message_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolution_source_message_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolution_source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_proposals_source_message_id_uq` ON `meal_proposals` (`source_message_id`);--> statement-breakpoint
CREATE INDEX `meal_proposals_sender_status_created_at_idx` ON `meal_proposals` (`sender_id`,`status`,`created_at`);