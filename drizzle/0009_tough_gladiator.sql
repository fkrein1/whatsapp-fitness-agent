CREATE TABLE `agent_soul_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`revision` integer NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_soul_changes_sender_revision_idx` ON `agent_soul_changes` (`sender_id`,`revision`);--> statement-breakpoint
CREATE INDEX `agent_soul_changes_source_message_id_idx` ON `agent_soul_changes` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `agent_souls` (
	`sender_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
