# Legacy migrations archive (non-executable evidence)

The files in this directory are preserved strictly as immutable historical and
archaeological evidence. They must **not** be executed as part of active
migrations or automated database setups.

## Why these files are non-executable

1. **Duplicate version timestamp prefixes**:
   `20260803_official_templates.sql` and `20260803_offline_first_rxdb.sql` share
   the identical version prefix `20260803`. SQLx requires strictly unique,
   ordered migration versions and aborts when duplicate prefixes exist.

2. **Missing root table definitions**:
   `20260803_offline_first_rxdb.sql` defines foreign key constraints referencing
   `users(id)` and drops legacy tables, but never provisions the `users` table
   itself. Executing this on an empty database fails with `relation "users" does not exist`.

3. **Contradictory schema operations**:
   `20260807_food_versions_id_sequence.sql` attempts to repair and alter the
   sequence on `public.food_versions`, a table that was already dropped by
   `20260803_offline_first_rxdb.sql`.

4. **Incomplete data model**:
   Core domain tables (such as `weight_logs` introduced in BAL-014) and required
   integrity constraints are missing from this fragmented sequence.

## Canonical active migrations

The active, canonical SQLx migration sequence is located in `apps/server/migrations/`.
All new installations and CI pipelines provision their schema from the canonical
baseline migration (`20260821000000_canonical_baseline.sql`).

The `operations/` directory also preserves the manually applied additive and
destructive scripts that preceded the SQLx baseline. They are evidence only;
future agents must follow `docs/database-migrations.md` instead of executing or
copying them.
