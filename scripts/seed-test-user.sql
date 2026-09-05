-- Controlled test identity for CI and integration tests.
-- Assumes active SQLx migrations have provisioned the canonical schema.
-- Never execute this script against a production database.

\set ON_ERROR_STOP on

DO $test_seed_guard$
BEGIN
    IF current_database() = 'meal_logger' THEN
        RAISE EXCEPTION 'refusing to seed the production meal_logger database';
    END IF;
END
$test_seed_guard$;

INSERT INTO users (id, email)
VALUES (1, 'sqlx-ci@example.invalid')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM users)), true);
