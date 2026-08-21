# Balance server instructions

For the current PostgreSQL schema, begin with
`../../docs/generated/database-schema.md`. Treat that generated, data-free
catalog as the LLM discovery view; do not reconstruct the current schema by
manually reading the migration chain.

The active SQLx migrations under `migrations/` remain the executable source of
truth. Read them when implementing a schema change, rebuilding an environment,
diagnosing a snapshot mismatch, or auditing migration history. Read
`../../docs/database-migrations.md` before changing or running migrations.

Application query behavior still lives in the Rust code and SQLx metadata. Use
the snapshot for database structure, then inspect the relevant code when the
task concerns runtime semantics or service interfaces.
