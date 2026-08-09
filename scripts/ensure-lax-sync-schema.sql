-- Additive, idempotent production preparation for BAL-011.
--
-- This script intentionally does not use the historical SQLx migration chain:
-- that chain contains duplicate version prefixes. It never drops a table or
-- overwrites an existing lax document. Run with ON_ERROR_STOP inside a reviewed
-- transaction after taking a production backup.

BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE IF NOT EXISTS meal_templates (
    id UUID PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    name VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

ALTER TABLE meal_templates
    ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE meal_templates
    ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS meal_logs (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES meal_templates(id) ON DELETE SET NULL,
    name_snapshot VARCHAR(255) NOT NULL,
    nutrition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    quantity DOUBLE PRECISION NOT NULL,
    consumed_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_sync
    ON user_preferences (id, updated_at);
CREATE INDEX IF NOT EXISTS idx_meal_templates_sync
    ON meal_templates (user_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_meal_templates_official
    ON meal_templates (is_official, deleted_at);
CREATE INDEX IF NOT EXISTS idx_meal_logs_sync
    ON meal_logs (user_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_meal_logs_daily
    ON meal_logs (user_id, consumed_at) WHERE deleted_at IS NULL;

-- Installations that still contain the strict food model retain their current
-- library through a deterministic, repeatable backfill. Dynamic SQL keeps the
-- script valid on installations where those legacy tables no longer exist.
DO $backfill$
BEGIN
    IF to_regclass('public.foods') IS NOT NULL
       AND to_regclass('public.food_versions') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO meal_templates
                (id, user_id, is_official, name, details, updated_at, deleted_at)
            SELECT
                md5('balance:legacy-food:' || f.id::text)::uuid,
                CASE WHEN fv.is_verified THEN NULL ELSE f.created_by END,
                fv.is_verified,
                fv.name,
                jsonb_build_object(
                    'schemaVersion', 1,
                    'baseAmount', fv.serving_quantity::double precision,
                    'unit', CASE fv.serving_unit_type::text
                        WHEN 'volume' THEN 'ml'
                        ELSE 'g'
                    END,
                    'nutrition', jsonb_build_object(
                        'calories', fv.calories::double precision,
                        'protein', fv.proteins::double precision,
                        'carbs', fv.carbs::double precision,
                        'fat', fv.fat::double precision,
                        'fiber', COALESCE(fv.fiber, 0)::double precision,
                        'sodiumMg', fv.sodium,
                        'cholesterolMg', fv.cholesterol
                    ),
                    'chileanSeals', '[]'::jsonb,
                    'category', NULL,
                    'typicalTime', NULL
                ),
                floor(extract(epoch from f.updated_at) * 1000)::bigint,
                NULL
            FROM foods f
            JOIN food_versions fv ON fv.id = f.current_version_id
            WHERE fv.serving_quantity > 0
            ON CONFLICT (id) DO NOTHING
        $sql$;
    END IF;
END
$backfill$;

COMMIT;
