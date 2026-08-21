-- Canonical schema baseline for Balance API (BAL-029).
-- Provisions the complete seven-table production schema on an empty database.
--
-- Existing installations MUST pass scripts/verify-schema-fingerprint.sh before
-- this migration is adopted. IF NOT EXISTS makes adoption non-destructive; it
-- is not a substitute for the exact catalog comparison in that preflight.

DO $baseline_guard$
DECLARE
    application_table_count INTEGER;
BEGIN
    SELECT count(*) INTO application_table_count
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
          'users',
          'user_preferences',
          'meal_templates',
          'meal_logs',
          'weight_logs',
          'food_import_sessions',
          'food_import_rows'
      );

    IF application_table_count NOT IN (0, 7) THEN
        RAISE EXCEPTION
            'refusing partial baseline adoption: found % of 7 canonical tables',
            application_table_count;
    END IF;
END
$baseline_guard$;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at TIMESTAMP DEFAULT now(),
    family_name TEXT,
    given_name TEXT,
    picture TEXT
);

CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT
);

CREATE TABLE IF NOT EXISTS meal_templates (
    id UUID PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    source_provider VARCHAR(32),
    external_id VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS meal_logs (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES meal_templates(id) ON DELETE SET NULL,
    name_snapshot VARCHAR(255) NOT NULL,
    nutrition_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    consumed_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,
    source_provider VARCHAR(32),
    external_id VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS weight_logs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    measured_on DATE NOT NULL,
    weight_grams INTEGER NOT NULL CHECK (
        weight_grams BETWEEN 1000 AND 500000
        AND weight_grams % 100 = 0
    ),
    updated_at BIGINT NOT NULL,
    deleted_at BIGINT,
    PRIMARY KEY (user_id, measured_on)
);

CREATE TABLE IF NOT EXISTS food_import_sessions (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(32) NOT NULL,
    file_fingerprint VARCHAR(128) NOT NULL,
    expected_rows INTEGER NOT NULL CHECK (expected_rows BETWEEN 1 AND 100000),
    templates JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(16) NOT NULL CHECK (status IN ('staged', 'committed', 'cancelled')),
    summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS food_import_rows (
    session_id UUID NOT NULL REFERENCES food_import_sessions(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL CHECK (row_index >= 2),
    payload JSONB NOT NULL,
    PRIMARY KEY (session_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_sync ON user_preferences (id, updated_at);
CREATE INDEX IF NOT EXISTS idx_meal_templates_sync ON meal_templates (user_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_meal_templates_official ON meal_templates (is_official, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_templates_import_identity
    ON meal_templates (user_id, source_provider, external_id)
    WHERE source_provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meal_logs_sync ON meal_logs (user_id, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_meal_logs_daily
    ON meal_logs (user_id, consumed_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_logs_import_identity
    ON meal_logs (user_id, source_provider, external_id)
    WHERE source_provider IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_weight_logs_sync
    ON weight_logs (user_id, updated_at, measured_on);
CREATE INDEX IF NOT EXISTS idx_food_import_sessions_owner
    ON food_import_sessions (user_id, created_at DESC);
