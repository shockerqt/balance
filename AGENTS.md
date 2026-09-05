# Balance repository instructions

Before building a mobile artifact or publishing an OTA, read
`docs/eas-daily-use.md` and inspect the existing workflows under
`.github/workflows/`.

Delivery is part of finishing user-facing changes unless the task explicitly
limits scope to integration. Read `docs/delivery.md` before release work.
Merge to `main` starts `Deliver Balance Clients`, which verifies the exact commit
before calling `Publish Balance Daily OTA` and promoting the dashboard artifact.
Never bypass this DAG by publishing locally. API deployment uses `Promote Balance
API` with explicit approval of the source artifact and production state.

For tasks including delivery, keep the task active until the run records the
published SHA, Actions run/artifact or EAS update IDs, target environment and
post-publication checks. Record `NEW_APK_REQUIRED`, pending API approval, failed
publication or recovery as outstanding work; passing CI or merge alone is not
delivery. Do not rewrite completed historical tasks to claim later publication.

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
