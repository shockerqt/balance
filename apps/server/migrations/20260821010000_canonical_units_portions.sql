-- BAL-027: make g/ml the only nutrition basis and preserve entered portion evidence.

CREATE OR REPLACE FUNCTION pg_temp.scale_nutrition(nutrition jsonb, factor double precision)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT COALESCE(jsonb_object_agg(key,
    CASE
      WHEN key = 'extendedNutrition' AND jsonb_typeof(value) = 'object' THEN
        (SELECT COALESCE(jsonb_object_agg(e.key, to_jsonb((e.value #>> '{}')::double precision * factor)), '{}'::jsonb)
         FROM jsonb_each(value) e)
      WHEN jsonb_typeof(value) = 'number' THEN to_jsonb((value #>> '{}')::double precision * factor)
      ELSE value
    END), '{}'::jsonb)
FROM jsonb_each(nutrition)
$$;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM meal_templates
    WHERE COALESCE((details->>'schemaVersion')::int, 0) = 1
      AND details->>'unit' NOT IN ('g', 'ml')
      AND NOT (
        jsonb_typeof(details->'gramsPerUnit') = 'number'
        AND (details->>'gramsPerUnit')::double precision > 0
      )
  ) THEN
    RAISE EXCEPTION 'BAL-027 cannot safely migrate a legacy food without canonical conversion metadata';
  END IF;
  IF EXISTS (
    SELECT 1 FROM meal_logs
    WHERE COALESCE((nutrition_snapshot->>'schemaVersion')::int, 0) = 1
      AND nutrition_snapshot->>'unit' NOT IN ('g', 'ml')
      AND NOT (
        jsonb_typeof(nutrition_snapshot->'gramsPerUnit') = 'number'
        AND (nutrition_snapshot->>'gramsPerUnit')::double precision > 0
      )
  ) THEN
    RAISE EXCEPTION 'BAL-027 cannot safely migrate a legacy log without canonical conversion metadata';
  END IF;
END
$guard$;

UPDATE meal_templates
SET details = jsonb_strip_nulls(jsonb_build_object(
  'schemaVersion', 2,
  'canonicalUnit', CASE WHEN details->>'unit' = 'ml' THEN 'ml' ELSE 'g' END,
  'nutritionPer100', pg_temp.scale_nutrition(
      details->'nutrition',
      100.0 / ((details->>'baseAmount')::double precision *
        CASE WHEN details->>'unit' IN ('g','ml') THEN 1.0 ELSE (details->>'gramsPerUnit')::double precision END)
  ),
  'portions', CASE
      WHEN jsonb_typeof(details->'gramsPerUnit') = 'number' AND (details->>'gramsPerUnit')::double precision > 0 THEN
        jsonb_build_array(jsonb_build_object(
          'id', 'legacy-serving',
          'name', COALESCE(NULLIF(details->>'servingLabel',''), details->>'unit'),
          'portionQuantity', 1,
          'canonicalQuantity', (details->>'gramsPerUnit')::double precision
        ))
      ELSE '[]'::jsonb END,
  'chileanSeals', COALESCE(details->'chileanSeals','[]'::jsonb),
  'category', details->'category',
  'typicalTime', details->'typicalTime'
))
WHERE COALESCE((details->>'schemaVersion')::int, 0) = 1;

ALTER TABLE meal_logs RENAME COLUMN quantity TO canonical_quantity;
ALTER TABLE meal_logs ADD COLUMN entry_snapshot JSONB;

UPDATE meal_logs
SET
  canonical_quantity = canonical_quantity * CASE
      WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN 1.0
      ELSE (nutrition_snapshot->>'gramsPerUnit')::double precision END,
  entry_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'enteredQuantity', canonical_quantity,
      'portionSnapshot', CASE
        WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN NULL
        ELSE jsonb_build_object(
          'name', COALESCE(NULLIF(nutrition_snapshot->>'servingLabel',''), nutrition_snapshot->>'unit'),
          'portionQuantity', 1,
          'canonicalQuantity', (nutrition_snapshot->>'gramsPerUnit')::double precision
        ) END
  )),
  nutrition_snapshot = jsonb_build_object(
      'schemaVersion', 2,
      'canonicalUnit', CASE WHEN nutrition_snapshot->>'unit' = 'ml' THEN 'ml' ELSE 'g' END,
      'nutritionPer100', pg_temp.scale_nutrition(
          nutrition_snapshot->'nutrition',
          100.0 / ((nutrition_snapshot->>'baseAmount')::double precision *
            CASE WHEN nutrition_snapshot->>'unit' IN ('g','ml') THEN 1.0 ELSE (nutrition_snapshot->>'gramsPerUnit')::double precision END)
      )
  )
WHERE COALESCE((nutrition_snapshot->>'schemaVersion')::int, 0) = 1;

-- Direct canonical legacy logs need the original quantity as entered evidence.
UPDATE meal_logs
SET entry_snapshot = jsonb_build_object('enteredQuantity', canonical_quantity)
WHERE entry_snapshot IS NULL OR entry_snapshot = '{}'::jsonb;

ALTER TABLE meal_logs ALTER COLUMN entry_snapshot SET NOT NULL;
ALTER TABLE meal_logs ADD CONSTRAINT meal_logs_canonical_quantity_positive CHECK (canonical_quantity > 0);
