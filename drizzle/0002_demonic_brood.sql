CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_canonical_name_uq` ON `exercises` (`canonical_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_normalized_name_uq` ON `exercises` (`normalized_name`);
--> statement-breakpoint
CREATE TABLE `exercise_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_aliases_normalized_alias_uq` ON `exercise_aliases` (`normalized_alias`);
--> statement-breakpoint
CREATE INDEX `exercise_aliases_exercise_id_idx` ON `exercise_aliases` (`exercise_id`);
--> statement-breakpoint
INSERT INTO `exercises` (`id`, `canonical_name`, `normalized_name`, `created_at`) VALUES
	('ex_barbell_row', 'Barbell Row', 'barbell row', unixepoch() * 1000),
	('ex_barbell_shoulder_press', 'Barbell Shoulder Press', 'barbell shoulder press', unixepoch() * 1000),
	('ex_bench_press', 'Bench Press', 'bench press', unixepoch() * 1000),
	('ex_bulgarian_split_squat', 'Bulgarian Split Squat', 'bulgarian split squat', unixepoch() * 1000),
	('ex_cable_lateral_raise', 'Cable Lateral Raise', 'cable lateral raise', unixepoch() * 1000),
	('ex_cable_row', 'Cable Row', 'cable row', unixepoch() * 1000),
	('ex_dumbbell_bench_press', 'Dumbbell Bench Press', 'dumbbell bench press', unixepoch() * 1000),
	('ex_dumbbell_shoulder_press', 'Dumbbell Shoulder Press', 'dumbbell shoulder press', unixepoch() * 1000),
	('ex_front_squat', 'Front Squat', 'front squat', unixepoch() * 1000),
	('ex_lat_pulldown', 'Lat Pulldown', 'lat pulldown', unixepoch() * 1000),
	('ex_machine_bench_press', 'Machine Bench Press', 'machine bench press', unixepoch() * 1000),
	('ex_machine_chest_fly', 'Machine Chest Fly', 'machine chest fly', unixepoch() * 1000),
	('ex_pull_up', 'Pull-Up', 'pull up', unixepoch() * 1000),
	('ex_romanian_deadlift', 'Romanian Deadlift', 'romanian deadlift', unixepoch() * 1000),
	('ex_single_leg_curl', 'Single-Leg Curl', 'single leg curl', unixepoch() * 1000),
	('ex_single_leg_extension', 'Single-Leg Extension', 'single leg extension', unixepoch() * 1000),
	('ex_single_leg_press', 'Single-Leg Press', 'single leg press', unixepoch() * 1000);
--> statement-breakpoint
INSERT INTO `exercise_aliases` (`id`, `exercise_id`, `alias`, `normalized_alias`, `created_at`) VALUES
	('alias_barbel_row', 'ex_barbell_row', 'Barbel Row', 'barbel row', unixepoch() * 1000),
	('alias_barbell_row', 'ex_barbell_row', 'Barbell Row', 'barbell row', unixepoch() * 1000),
	('alias_barbel_shoulder_press', 'ex_barbell_shoulder_press', 'Barbel Shoulder Press', 'barbel shoulder press', unixepoch() * 1000),
	('alias_barbell_shoulder_press', 'ex_barbell_shoulder_press', 'Barbell Shoulder Press', 'barbell shoulder press', unixepoch() * 1000),
	('alias_bench_press', 'ex_bench_press', 'Bench Press', 'bench press', unixepoch() * 1000),
	('alias_bulgarian_split', 'ex_bulgarian_split_squat', 'Bulgarian Split', 'bulgarian split', unixepoch() * 1000),
	('alias_bulgarian_split_squat', 'ex_bulgarian_split_squat', 'Bulgarian Split Squat', 'bulgarian split squat', unixepoch() * 1000),
	('alias_cable_lateral_raise', 'ex_cable_lateral_raise', 'Cable Lateral Raise', 'cable lateral raise', unixepoch() * 1000),
	('alias_cable_row', 'ex_cable_row', 'Cable Row', 'cable row', unixepoch() * 1000),
	('alias_db_bench_press', 'ex_dumbbell_bench_press', 'DB Bench Press', 'db bench press', unixepoch() * 1000),
	('alias_dumbbell_bench_press', 'ex_dumbbell_bench_press', 'Dumbbell Bench Press', 'dumbbell bench press', unixepoch() * 1000),
	('alias_db_shoulder_press', 'ex_dumbbell_shoulder_press', 'DB Shoulder Press', 'db shoulder press', unixepoch() * 1000),
	('alias_dumbbell_shoulder_press', 'ex_dumbbell_shoulder_press', 'Dumbbell Shoulder Press', 'dumbbell shoulder press', unixepoch() * 1000),
	('alias_front_squat', 'ex_front_squat', 'Front Squat', 'front squat', unixepoch() * 1000),
	('alias_lat_pulldown', 'ex_lat_pulldown', 'Lat Pulldown', 'lat pulldown', unixepoch() * 1000),
	('alias_m_bench_press', 'ex_machine_bench_press', 'M. Bench Press', 'm bench press', unixepoch() * 1000),
	('alias_machine_bench_press', 'ex_machine_bench_press', 'Machine Bench Press', 'machine bench press', unixepoch() * 1000),
	('alias_m_chest_fly', 'ex_machine_chest_fly', 'M. Chest Fly', 'm chest fly', unixepoch() * 1000),
	('alias_machine_chest_fly', 'ex_machine_chest_fly', 'Machine Chest Fly', 'machine chest fly', unixepoch() * 1000),
	('alias_pull_up', 'ex_pull_up', 'Pull-Up', 'pull up', unixepoch() * 1000),
	('alias_rdl', 'ex_romanian_deadlift', 'RDL', 'rdl', unixepoch() * 1000),
	('alias_rdls', 'ex_romanian_deadlift', 'RDLs', 'rdls', unixepoch() * 1000),
	('alias_romanian_deadlift', 'ex_romanian_deadlift', 'Romanian Deadlift', 'romanian deadlift', unixepoch() * 1000),
	('alias_romanian_deadlift_rdl', 'ex_romanian_deadlift', 'Romanian Deadlift (RDL)', 'romanian deadlift rdl', unixepoch() * 1000),
	('alias_single_leg_curl', 'ex_single_leg_curl', 'Single-Leg Curl', 'single leg curl', unixepoch() * 1000),
	('alias_single_leg_extension', 'ex_single_leg_extension', 'Single-Leg Extension', 'single leg extension', unixepoch() * 1000),
	('alias_single_leg_press', 'ex_single_leg_press', 'Single-Leg Press', 'single leg press', unixepoch() * 1000);
--> statement-breakpoint
ALTER TABLE `exercise_sets` ADD `exercise_id` text REFERENCES exercises(id);
--> statement-breakpoint
UPDATE `exercise_sets`
SET `exercise_id` = (
	SELECT `exercises`.`id`
	FROM `exercises`
	WHERE `exercises`.`canonical_name` = `exercise_sets`.`exercise`
);
--> statement-breakpoint
CREATE INDEX `exercise_sets_exercise_id_idx` ON `exercise_sets` (`exercise_id`);
