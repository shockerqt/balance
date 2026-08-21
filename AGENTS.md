# Balance repository instructions

Before building a mobile artifact or publishing an OTA, read
`docs/eas-daily-use.md` and inspect the existing workflows under
`.github/workflows/`.

Publish Balance Daily OTAs from integrated `main` through the
`Publish Balance Daily OTA` GitHub Actions workflow.

Follow any more specific `AGENTS.md` file that covers the files being changed.

## Database schema discovery

For the current PostgreSQL schema, read
`docs/generated/database-schema.md` first. It is the compact, data-free catalog
generated for human and LLM inspection and verified by CI. Do not infer the
current schema by manually replaying or summarizing migration files.

Active files under `apps/server/migrations/` remain the executable source of
truth. Inspect them when changing the schema, rebuilding a database, diagnosing
snapshot generation, or auditing migration history. Before any migration work,
also read `docs/database-migrations.md`.
