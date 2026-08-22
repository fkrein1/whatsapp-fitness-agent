INSERT OR IGNORE INTO exercises (id, canonical_name, normalized_name, created_at) VALUES
	('cleanup_kettlebell_reverse_lunge', 'Kettlebell Reverse Lunge', 'kettlebell reverse lunge', unixepoch() * 1000),
	('cleanup_kettlebell_squat', 'Kettlebell Squat', 'kettlebell squat', unixepoch() * 1000);
--> statement-breakpoint
UPDATE exercise_sets
SET exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kettlebell reverse lunge')
WHERE exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kt reverse lunge');
--> statement-breakpoint
UPDATE exercise_aliases
SET exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kettlebell reverse lunge')
WHERE exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kt reverse lunge');
--> statement-breakpoint
DELETE FROM exercises WHERE normalized_name = 'kt reverse lunge';
--> statement-breakpoint
UPDATE exercise_sets
SET exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kettlebell squat')
WHERE exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kt squat');
--> statement-breakpoint
UPDATE exercise_aliases
SET exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kettlebell squat')
WHERE exercise_id = (SELECT id FROM exercises WHERE normalized_name = 'kt squat');
--> statement-breakpoint
DELETE FROM exercises WHERE normalized_name = 'kt squat';
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_kettlebell_reverse_lunge_cleanup', id, 'Kettlebell Reverse Lunge', 'kettlebell reverse lunge', unixepoch() * 1000
FROM exercises
WHERE normalized_name = 'kettlebell reverse lunge';
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_kt_reverse_lunge_cleanup', id, 'KT Reverse Lunge', 'kt reverse lunge', unixepoch() * 1000
FROM exercises
WHERE normalized_name = 'kettlebell reverse lunge';
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_kettlebell_squat_cleanup', id, 'Kettlebell Squat', 'kettlebell squat', unixepoch() * 1000
FROM exercises
WHERE normalized_name = 'kettlebell squat';
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_kt_squat_cleanup', id, 'KT Squat', 'kt squat', unixepoch() * 1000
FROM exercises
WHERE normalized_name = 'kettlebell squat';
