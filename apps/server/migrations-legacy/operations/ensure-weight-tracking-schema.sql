-- Additive, idempotent production preparation for BAL-014.
--
-- The historical migration chain is immutable and cannot currently be used as
-- a production ledger. Run this script with ON_ERROR_STOP inside a reviewed
-- change window, after a verified database backup and before deploying the
-- BAL-014 server binary.

BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_weight_logs_sync
    ON weight_logs (user_id, updated_at, measured_on);

COMMIT;
