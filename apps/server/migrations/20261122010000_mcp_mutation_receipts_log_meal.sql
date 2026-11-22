-- Additive forward-only expansion of mcp_mutation_receipts.tool_name to allow
-- idempotent replay receipts for the log_meal MCP tool.
--
-- Binary compatibility:
--   Fully backward-compatible and additive. Existing running binaries only
--   write 'create_food' and 'log_food', which remain valid under the widened
--   CHECK constraint.
-- Lock expectations:
--   Acquires ACCESS EXCLUSIVE on mcp_mutation_receipts briefly to drop and
--   re-add mcp_mutation_receipts_tool_name_check. The table is small and new,
--   and no existing rows violate the strictly wider allowed set. Takes no
--   locks on meal_templates or meal_logs.
-- Backfill:
--   None (zero backfill).
-- Rollback:
--   Additive rollback: restore the previous binary while the widened CHECK
--   constraint remains in place.

ALTER TABLE mcp_mutation_receipts
    DROP CONSTRAINT mcp_mutation_receipts_tool_name_check,
    ADD CONSTRAINT mcp_mutation_receipts_tool_name_check
        CHECK (tool_name IN ('create_food', 'log_food', 'log_meal'));
