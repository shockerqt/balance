ALTER TABLE meal_templates
    ADD COLUMN IF NOT EXISTS source_provider VARCHAR(32),
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(128);

ALTER TABLE meal_logs
    ADD COLUMN IF NOT EXISTS source_provider VARCHAR(32),
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_templates_import_identity
    ON meal_templates (user_id, source_provider, external_id)
    WHERE source_provider IS NOT NULL AND external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_logs_import_identity
    ON meal_logs (user_id, source_provider, external_id)
    WHERE source_provider IS NOT NULL AND external_id IS NOT NULL;

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

CREATE INDEX IF NOT EXISTS idx_food_import_sessions_owner
    ON food_import_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS food_import_rows (
    session_id UUID NOT NULL REFERENCES food_import_sessions(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL CHECK (row_index >= 2),
    payload JSONB NOT NULL,
    PRIMARY KEY (session_id, row_index)
);
