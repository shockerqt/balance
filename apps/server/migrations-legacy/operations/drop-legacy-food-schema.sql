-- Destructive BAL-011 cleanup. Run only after a reviewed production backup.
-- The canonical model is meal_templates + meal_logs; identity data is not
-- touched. PostgreSQL will abort if an unexpected dependency still exists.

BEGIN;

DROP TABLE IF EXISTS meal_foods;
DROP TABLE IF EXISTS meals;
DROP TABLE IF EXISTS foods;
DROP TABLE IF EXISTS food_versions;
DROP TYPE IF EXISTS serving_unit_type;
DROP SEQUENCE IF EXISTS food_versions_id_seq;

COMMIT;
