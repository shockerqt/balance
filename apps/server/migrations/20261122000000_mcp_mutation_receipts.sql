-- Additive forward-only MCP mutation receipt table for idempotent create_food
-- and log_food retries.
--
-- Binary compatibility:
--   Fully additive. The previous server binary ignores mcp_mutation_receipts,
--   and any rows it writes without a receipt remain legacy unverified rows.
-- Lock expectations:
--   Creates a new table and validates a foreign key to users(id). Takes no
--   locks on meal_templates or meal_logs.
-- Backfill:
--   None (zero backfill). Legacy rows without receipts conflict safely on
--   operationId reuse.
-- Rollback:
--   Additive rollback: restore the previous binary while this table remains.

CREATE TABLE mcp_mutation_receipts (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_name text NOT NULL CHECK (tool_name IN ('create_food', 'log_food')),
    operation_id uuid NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version >= 1),
    request_intent jsonb NOT NULL,
    target_state jsonb NOT NULL,
    created_at bigint NOT NULL DEFAULT floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
    PRIMARY KEY (user_id, tool_name, operation_id)
);
