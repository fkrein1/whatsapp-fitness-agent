CREATE TABLE `exercise_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`exercise` text NOT NULL,
	`set_number` integer,
	`reps` integer,
	`weight_kg` real,
	`duration_seconds` integer,
	`distance_meters` real,
	FOREIGN KEY (`event_id`) REFERENCES `fitness_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercise_sets_event_id_idx` ON `exercise_sets` (`event_id`);--> statement-breakpoint
CREATE TABLE `fitness_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`summary` text NOT NULL,
	`confidence` real NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_message_id`) REFERENCES `source_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fitness_events_kind_occurred_at_idx` ON `fitness_events` (`kind`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `fitness_events_source_message_id_idx` ON `fitness_events` (`source_message_id`);--> statement-breakpoint
CREATE TABLE `meal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`calories_kcal` real,
	`protein_grams` real,
	`carbs_grams` real,
	`fat_grams` real,
	`confidence` real NOT NULL,
	`nutrition_source` text DEFAULT 'model_estimate' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `fitness_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_items_event_id_idx` ON `meal_items` (`event_id`);--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `fitness_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `measurements_metric_event_id_idx` ON `measurements` (`metric`,`event_id`);--> statement-breakpoint
CREATE TABLE `source_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_message_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`input_type` text NOT NULL,
	`text` text,
	`media_id` text,
	`mime_type` text,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_messages_provider_message_id_uq` ON `source_messages` (`provider_message_id`);--> statement-breakpoint
CREATE INDEX `source_messages_received_at_idx` ON `source_messages` (`received_at`);