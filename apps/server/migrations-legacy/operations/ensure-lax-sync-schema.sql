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

COMMIT;
