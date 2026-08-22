ALTER TABLE `fitness_events` ADD `external_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `fitness_events_external_key_unique` ON `fitness_events` (`external_key`);