INSERT OR IGNORE INTO exercise_aliases (id, exercise_id, alias, normalized_alias, created_at)
SELECT 'alias_supino', id, 'Supino', 'supino', unixepoch() * 1000
FROM exercises
WHERE normalized_name = 'bench press';
