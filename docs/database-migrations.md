# Balance database migrations

This is the operational contract for humans and LLM agents changing the Balance
PostgreSQL schema. The active SQLx files in `apps/server/migrations/` are the
schema source of truth. The generated snapshot in
`docs/generated/database-schema.md` is a read-only aid, never hand-authored.

## Authority and safety boundary

Repository approval is not production approval. An agent may implement and
test migrations in the governed task worktree, but it must receive a separate,
explicit approval in the current conversation before changing `meal_logger`,
restarting `balance-server`, or deploying a binary.

Before production work, the agent must read:

1. workspace and Balance `AGENTS.md` instructions;
2. the current Governance task and run;
3. `governance/architecture/projects/balance.md`;
4. `infrastructure/balance/README.md`;
5. this runbook and the release workflow.

Never print, copy into Governance, or pass through an LLM prompt a database
password, application environment value, private key, backup content, or user
row. PostgreSQL stays local to the production host; never open port 5432. The
current Codex workspace and production services share one host, so a local
Codex session must not SSH to the host's own public address. A remote CI runner
may use the existing SSH delivery path and invoke the same host-local procedure.

## Migration philosophy

- Add forward-only migrations after the baseline. Once a migration has been
  applied anywhere shared, its version, name and contents are immutable.
- Use `expand -> deploy/backfill -> contract` for incompatible changes. The
  expand migration must tolerate the previous binary. Destructive cleanup is a
  later, separately approved migration after every consumer has moved.
- Roll back application failures by restoring the previous binary while the
  additive schema remains. Do not depend on down migrations for routine
  rollback.
- Do not compact by migration count. Create a new baseline only as an explicit
  project when replay is operationally expensive, retired technology prevents
  reliable provisioning, or every known environment has crossed a verified
  cutoff. Archive rather than rewrite the previous chain.
- An LLM does not infer the current schema by reading every migration. It
  creates an ephemeral database, runs the chain, and inspects PostgreSQL's
  catalog or the CI-generated snapshot.

## Development procedure

1. Create or reuse a Governance task, branch and exclusive worktree.
2. Add one uniquely versioned file under `apps/server/migrations/`. Never edit
   the baseline or another applied migration.
3. Prefer additive DDL. State binary compatibility, lock expectations,
   backfill bounds and rollback behavior in SQL comments and the task run.
4. Regenerate the data-free snapshot:

   ```bash
   make schema-snapshot
   ```

   This uses PostgreSQL 17 through `pg_virtualenv`, applies every active SQLx
   migration to an empty database, reads `pg_catalog`, and rewrites
   `docs/generated/database-schema.md`. It never connects to production.
5. Run the same database-backed verification as CI. The CI job creates a fresh
   PostgreSQL 17 database, runs `cargo sqlx migrate run`, verifies the snapshot,
   seeds only the controlled test identity, regenerates SQLx metadata, and runs
   all server tests with `BALANCE_TEST_DATABASE_URL` set.
6. Review the migration and generated snapshot together. A snapshot difference
   without an intentional migration, or a migration without the corresponding
   snapshot difference, blocks integration.

## Generated snapshot contract

`scripts/schema-catalog.sql` emits sorted, data-free records for public tables,
sequences, columns, defaults, constraints and indexes. It excludes the SQLx
ledger object so the same fingerprint can compare a fresh database with an
existing production schema before ledger adoption.

`scripts/render-schema-snapshot.sh` writes the catalog, PostgreSQL major,
migration head and SHA-256 fingerprint. CI regenerates it into a temporary file
and fails on any diff. Do not edit the generated Markdown manually.

`scripts/verify-schema-fingerprint.sh` performs the production comparison in
read-only mode. A mismatch is a hard stop: inspect the catalog difference and
create a reviewed reconciliation plan. Never make production match the snapshot
automatically.

## One-time production baseline adoption

This section applies only while `meal_logger` has the verified canonical tables
but no `_sqlx_migrations` ledger. The baseline uses non-destructive
`IF NOT EXISTS` statements so SQLx can record that existing schema. Safety comes
from the exact fingerprint preflight; skipping it is forbidden.

The operator or guiding LLM must perform and record these gates in order:

1. Confirm the task branch is integrated into `balance/main`, the checkout is
   clean, and the exact commit is the approved release source. Do not migrate
   from an unintegrated worktree.
2. Revalidate service/database topology and verify PostgreSQL and
   `balance-server` are healthy. Confirm `_sqlx_migrations` is absent and do not
   read application rows.
3. Compare production with the generated snapshot from the same commit:

   ```bash
   balance_release_dir=/home/ubuntu/workspace/balance
   sudo -u postgres env DATABASE_URL=postgresql:///meal_logger \
     "$balance_release_dir/scripts/verify-schema-fingerprint.sh" \
     "$balance_release_dir/docs/generated/database-schema.md"
   ```

4. Create a timestamped custom-format backup under the protected Balance backup
   directory, validate it with `pg_restore --list`, calculate its SHA-256, and
   record only path, size, hash and validation result in the Governance run:

   ```bash
   migration_stamp=$(date -u +%Y%m%d-%H%M%S)
   backup_path="/var/backups/balance/meal_logger-before-baseline-$migration_stamp.dump"
   sudo install -d -m 0700 -o postgres -g postgres /var/backups/balance
   sudo -u postgres pg_dump -Fc -d meal_logger -f "$backup_path"
   sudo -u postgres pg_restore --list "$backup_path" >/dev/null
   sudo sha256sum "$backup_path"
   ```

5. Stop and ask for the separate production approval. The approval must identify
   the release commit, expected schema fingerprint, backup path/hash and exact
   migration head. A previous approval to implement or test is insufficient.
6. After approval, run the active chain locally as the schema-owning
   `meal_admin` role without exposing a password. PostgreSQL's local operating
   account authenticates through the socket and sets the database role for DDL
   ownership:

   ```bash
   sudo -u postgres env PGOPTIONS='-c role=meal_admin' \
     /home/ubuntu/.cargo/bin/sqlx migrate run \
       --source "$balance_release_dir/apps/server/migrations" \
       --database-url postgresql:///meal_logger
   ```

7. Verify that `_sqlx_migrations` contains exactly the expected successful head
   and checksum, rerun the schema fingerprint, check service health and inspect
   warning-or-higher logs. Baseline adoption should not require a service
   restart because the verified application schema does not change.
8. If the migration fails, do not retry blindly. Record the SQLx ledger state,
   confirm whether the transaction rolled back, preserve the backup and diagnose
   before requesting new authority. Never mark a failed row successful manually.

## Future production migrations

CI must first prove empty-database replay, snapshot consistency and server tests
for the exact commit. Production remains a manual GitHub Environment operation:
the approved workflow delivers the exact migration directory and release binary
to the host, and either a guiding LLM on the host or the workflow's SSH command
executes the host-local steps above. The workflow must not receive a PostgreSQL
password or connect to port 5432 remotely.

For every migration, record preflight fingerprint/head, backup evidence, explicit
approval, SQLx output summary, resulting head/checksum, binary hash, healthcheck
and rollback compatibility. Apply schema before a binary that requires it. If
the healthcheck fails, restore the previous binary only when the new migration
was designed to remain backward compatible; otherwise stop and use the migration
specific recovery plan and verified backup.

## Baseline renewal

A future baseline renewal is a separate governed project. Prove every known
environment has applied the cutoff migration, generate and test a new baseline,
archive the previous active chain unchanged, compare catalog fingerprints, and
adopt the replacement ledger environment by environment with explicit approval.
Never squash or alter checksummed files inside an existing ledger.
