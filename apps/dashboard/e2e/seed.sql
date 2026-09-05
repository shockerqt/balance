INSERT INTO users (id, email, name, given_name, family_name)
VALUES (9001, 'e2e@balance.test', 'E2E User', 'E2E', 'User')
ON CONFLICT (email) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('users', 'id'),
  GREATEST((SELECT MAX(id) FROM users), 1),
  true
);

INSERT INTO meal_templates (
  id,
  user_id,
  name,
  details,
  updated_at,
  is_official
)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  9001,
  'E2E oats',
  '{"schemaVersion":2,"canonicalUnit":"g","nutritionPer100":{"calories":380,"protein":13,"carbs":68,"fat":7,"fiber":10},"portions":[],"chileanSeals":[],"category":"grain","typicalTime":"08:00"}'::jsonb,
  (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
  false
)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  name = EXCLUDED.name,
  details = EXCLUDED.details,
  updated_at = EXCLUDED.updated_at,
  deleted_at = NULL;

INSERT INTO meal_logs (
  id,
  user_id,
  template_id,
  name_snapshot,
  nutrition_snapshot,
  canonical_quantity,
  entry_snapshot,
  consumed_at,
  updated_at
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  9001,
  '10000000-0000-4000-8000-000000000001',
  'E2E oats',
  '{"schemaVersion":2,"canonicalUnit":"g","nutritionPer100":{"calories":380,"protein":13,"carbs":68,"fat":7,"fiber":10}}'::jsonb,
  100,
  '{"enteredQuantity":100}'::jsonb,
  (
    extract(
      epoch FROM (
        ((clock_timestamp() AT TIME ZONE 'America/Santiago')::date + time '12:00')
        AT TIME ZONE 'America/Santiago'
      )
    ) * 1000
  )::bigint,
  (extract(epoch FROM clock_timestamp()) * 1000)::bigint
)
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  template_id = EXCLUDED.template_id,
  name_snapshot = EXCLUDED.name_snapshot,
  nutrition_snapshot = EXCLUDED.nutrition_snapshot,
  canonical_quantity = EXCLUDED.canonical_quantity,
  entry_snapshot = EXCLUDED.entry_snapshot,
  consumed_at = EXCLUDED.consumed_at,
  updated_at = EXCLUDED.updated_at,
  deleted_at = NULL;

-- Historical portion survives with no library template. Values match the
-- portable canonical-spoon fixture and the existing Rust domain example.
INSERT INTO meal_logs (
  id, user_id, template_id, name_snapshot, nutrition_snapshot,
  canonical_quantity, entry_snapshot, consumed_at, updated_at
)
SELECT
  '20000000-0000-4000-8000-000000000032', user_id, NULL,
  'E2E historic spoon',
  '{"schemaVersion":2,"canonicalUnit":"g","nutritionPer100":{"calories":400,"protein":30,"carbs":40,"fat":12,"fiber":0,"extendedNutrition":{"vitaminCMg":10}}}'::jsonb,
  30,
  '{"enteredQuantity":5,"portionSnapshot":{"portionId":"tbsp","name":"cucharada","portionQuantity":5,"canonicalQuantity":30}}'::jsonb,
  consumed_at + 60000, updated_at
FROM meal_logs WHERE id = '20000000-0000-4000-8000-000000000001'
ON CONFLICT (id) DO UPDATE SET
  nutrition_snapshot = EXCLUDED.nutrition_snapshot,
  canonical_quantity = EXCLUDED.canonical_quantity,
  entry_snapshot = EXCLUDED.entry_snapshot,
  consumed_at = EXCLUDED.consumed_at,
  updated_at = EXCLUDED.updated_at,
  deleted_at = NULL;
