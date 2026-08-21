-- Migration: Offline-First RxDB Schema with JSONB & Epoch Ms Timestamps

-- 1. Clean up legacy strict tables
DROP TABLE IF EXISTS meal_items CASCADE;
DROP TABLE IF EXISTS meals CASCADE;
DROP TABLE IF EXISTS food_versions CASCADE;
DROP TABLE IF EXISTS foods CASCADE;

-- 2. Table A: user_preferences (Syncable)
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_sync 
ON user_preferences (id, updated_at);

-- 3. Table B: meal_templates (Syncable)
CREATE TABLE IF NOT EXISTS meal_templates (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_meal_templates_sync 
ON meal_templates (user_id, updated_at, id);

-- 4. Table C: meal_logs (Syncable - Historical Inmutability)
CREATE TABLE IF NOT EXISTS meal_logs (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES meal_templates(id) ON DELETE SET NULL,
    name_snapshot VARCHAR(255) NOT NULL,
    nutrition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    consumed_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_meal_logs_sync 
ON meal_logs (user_id, updated_at, id);
