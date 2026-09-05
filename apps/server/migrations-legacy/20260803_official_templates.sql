-- Migration: Official Templates & Guest Mode Support
ALTER TABLE meal_templates ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE meal_templates ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_meal_templates_official 
ON meal_templates (is_official, deleted_at);
