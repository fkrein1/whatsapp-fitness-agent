CREATE TABLE exercise_merge_targets (
	id text PRIMARY KEY NOT NULL,
	canonical_name text NOT NULL,
	normalized_name text UNIQUE NOT NULL
);
--> statement-breakpoint
INSERT INTO exercise_merge_targets (id, canonical_name, normalized_name) VALUES
	('cleanup_abdominal', 'Abdominal', 'abdominal'),
	('cleanup_abdominal_bar', 'Abdominal na barra', 'abdominal na barra'),
	('cleanup_abdominal_plate', 'Abdominal com anilha', 'abdominal com anilha'),
	('ex_pull_up', 'Pull-Up', 'pull up'),
	('cleanup_dumbbell_lateral_raise', 'Dumbbell Lateral Raise', 'dumbbell lateral raise'),
	('cleanup_shoulder_press', 'Shoulder Press', 'shoulder press'),
	('cleanup_handstand_push_up', 'Handstand Push Up', 'handstand push up'),
	('ex_romanian_deadlift', 'Romanian Deadlift', 'romanian deadlift'),
	('cleanup_machine_shoulder_press', 'Machine Shoulder Press', 'machine shoulder press'),
	('ex_barbell_shoulder_press', 'Barbell Shoulder Press', 'barbell shoulder press'),
	('ex_barbell_row', 'Barbell Row', 'barbell row'),
	('cleanup_bench_row_db', 'Bench Row DB', 'bench row db'),
	('ex_dumbbell_bench_press', 'Dumbbell Bench Press', 'dumbbell bench press'),
	('ex_bench_press', 'Bench Press', 'bench press'),
	('ex_cable_lateral_raise', 'Cable Lateral Raise', 'cable lateral raise'),
	('ex_single_leg_extension', 'Single-Leg Extension', 'single leg extension'),
	('ex_single_leg_curl', 'Single-Leg Curl', 'single leg curl'),
	('cleanup_leg_extension', 'Leg Extension', 'leg extension'),
	('cleanup_leg_curl', 'Leg Curl', 'leg curl'),
	('cleanup_kettlebell_bench_press', 'Kettlebell Bench Press', 'kettlebell bench press'),
	('cleanup_kettlebell_row', 'Kettlebell Bent-Over Row', 'kettlebell bent over row'),
	('cleanup_kettlebell_bulgarian', 'Kettlebell Bulgarian Split Squat', 'kettlebell bulgarian split squat'),
	('cleanup_kettlebell_glute_bridge', 'Kettlebell Glute Bridge', 'kettlebell glute bridge'),
	('cleanup_kettlebell_lunge', 'Kettlebell Lunge', 'kettlebell lunge'),
	('cleanup_kettlebell_plank', 'Kettlebell Plank Pull Through', 'kettlebell plank pull through'),
	('cleanup_kettlebell_shoulder_press', 'Kettlebell Shoulder Press', 'kettlebell shoulder press'),
	('cleanup_kettlebell_squat_jump', 'Kettlebell Squat Jump', 'kettlebell squat jump'),
	('cleanup_kettlebell_swing', 'Kettlebell Swing', 'kettlebell swing'),
	('cleanup_kettlebell_tgu', 'Kettlebell Turkish Get-Up', 'kettlebell turkish get up');
--> statement-breakpoint
INSERT OR IGNORE INTO exercises (id, canonical_name, normalized_name, created_at)
SELECT id, canonical_name, normalized_name, unixepoch() * 1000
FROM exercise_merge_targets;
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_cleanup_target:' || target.normalized_name,
	exercise.id,
	target.canonical_name,
	target.normalized_name,
	unixepoch() * 1000
FROM exercise_merge_targets target
INNER JOIN exercises exercise ON exercise.normalized_name = target.normalized_name;
--> statement-breakpoint
CREATE TABLE exercise_merge_sources (
	source_normalized text PRIMARY KEY NOT NULL,
	source_alias text NOT NULL,
	target_normalized text NOT NULL
);
--> statement-breakpoint
INSERT INTO exercise_merge_sources (source_normalized, source_alias, target_normalized) VALUES
	('abdominais', 'Abdominais', 'abdominal'),
	('abs bar', 'ABS Bar', 'abdominal na barra'),
	('abs plate', 'ABS Plate', 'abdominal com anilha'),
	('barra fixa', 'Barra fixa', 'pull up'),
	('pull ups', 'Pull-ups', 'pull up'),
	('db lateral raise', 'DB Lateral Raise', 'dumbbell lateral raise'),
	('desenvolvimento de ombros', 'Desenvolvimento de ombros', 'shoulder press'),
	('hspu', 'HSPU', 'handstand push up'),
	('hspu handstand push up', 'HSPU (handstand push-up)', 'handstand push up'),
	('rmdl', 'RMDL', 'romanian deadlift'),
	('m shoulder press', 'M. Shoulder Press', 'machine shoulder press'),
	('shoulder press com barra', 'Shoulder press com barra', 'barbell shoulder press'),
	('remada com barra', 'Remada com barra', 'barbell row'),
	('remada com halteres', 'Remada com halteres', 'bench row db'),
	('supino com halteres', 'Supino com halteres', 'dumbbell bench press'),
	('supino reto', 'Supino reto', 'bench press'),
	('elevacao lateral unilateral no cabo', 'Elevação lateral unilateral no cabo', 'cable lateral raise'),
	('extensao de joelho unilateral', 'Extensão de joelho unilateral', 'single leg extension'),
	('extensao de perna unilateral', 'Extensão de perna unilateral', 'single leg extension'),
	('flexao de joelho unilateral', 'Flexão de joelho unilateral', 'single leg curl'),
	('flexao de perna unilateral', 'Flexão de perna unilateral', 'single leg curl'),
	('cadeira extensora', 'Cadeira extensora', 'leg extension'),
	('mesa flexora', 'Mesa flexora', 'leg curl'),
	('bench press com kettlebell', 'Bench press com kettlebell', 'kettlebell bench press'),
	('kt bench press', 'KT Bench Press', 'kettlebell bench press'),
	('bent over row com kettlebell', 'Bent-over row com kettlebell', 'kettlebell bent over row'),
	('kt bent over row', 'KT Bent Over Row', 'kettlebell bent over row'),
	('bulgarian split squat com kettlebell', 'Bulgarian split squat com kettlebell', 'kettlebell bulgarian split squat'),
	('kt bulgarian split', 'KT Bulgarian Split', 'kettlebell bulgarian split squat'),
	('kt bulgarian split squat', 'KT Bulgarian Split Squat', 'kettlebell bulgarian split squat'),
	('kettlebell bulgarian split', 'Kettlebell Bulgarian Split', 'kettlebell bulgarian split squat'),
	('glute bridge', 'Glute Bridge', 'kettlebell glute bridge'),
	('kt glute bridge', 'KT Glute Bridge', 'kettlebell glute bridge'),
	('kt lunge', 'KT Lunge', 'kettlebell lunge'),
	('kt plank pt', 'KT Plank PT', 'kettlebell plank pull through'),
	('kt plank pull through', 'KT Plank Pull Through', 'kettlebell plank pull through'),
	('kettlebell plank pt', 'Kettlebell plank PT', 'kettlebell plank pull through'),
	('kt shoulder press', 'KT Shoulder Press', 'kettlebell shoulder press'),
	('kt squat jump', 'KT Squat Jump', 'kettlebell squat jump'),
	('kt swing', 'KT Swing', 'kettlebell swing'),
	('swing', 'Swing', 'kettlebell swing'),
	('kt tgus', 'KT TGUs', 'kettlebell turkish get up');
--> statement-breakpoint
UPDATE exercise_sets
SET exercise_id = (
	SELECT target.id
	FROM exercise_merge_sources mapping
	INNER JOIN exercises source ON source.normalized_name = mapping.source_normalized
	INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized
	WHERE source.id = exercise_sets.exercise_id
)
WHERE exercise_id IN (
	SELECT source.id
	FROM exercise_merge_sources mapping
	INNER JOIN exercises source ON source.normalized_name = mapping.source_normalized
	INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized
);
--> statement-breakpoint
UPDATE exercise_aliases
SET exercise_id = (
	SELECT target.id
	FROM exercise_merge_sources mapping
	INNER JOIN exercises source ON source.normalized_name = mapping.source_normalized
	INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized
	WHERE source.id = exercise_aliases.exercise_id
)
WHERE exercise_id IN (
	SELECT source.id
	FROM exercise_merge_sources mapping
	INNER JOIN exercises source ON source.normalized_name = mapping.source_normalized
	INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized
);
--> statement-breakpoint
DELETE FROM exercises
WHERE id IN (
	SELECT source.id
	FROM exercise_merge_sources mapping
	INNER JOIN exercises source ON source.normalized_name = mapping.source_normalized
	INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized
);
--> statement-breakpoint
INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_cleanup_source:' || mapping.source_normalized,
	target.id,
	mapping.source_alias,
	mapping.source_normalized,
	unixepoch() * 1000
FROM exercise_merge_sources mapping
INNER JOIN exercises target ON target.normalized_name = mapping.target_normalized;
--> statement-breakpoint
UPDATE exercises
SET canonical_name = (
	SELECT target.canonical_name
	FROM exercise_merge_targets target
	WHERE target.normalized_name = exercises.normalized_name
)
WHERE normalized_name IN (SELECT normalized_name FROM exercise_merge_targets);
--> statement-breakpoint
DROP TABLE exercise_merge_sources;
--> statement-breakpoint
DROP TABLE exercise_merge_targets;
