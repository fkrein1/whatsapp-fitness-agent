CREATE TABLE `agent_turn_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_message_id` text NOT NULL,
	`stage` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_turn_events_source_created_at_idx` ON `agent_turn_events` (`source_message_id`,`created_at`);