# Balance server

The server listens on `127.0.0.1:8080` by default. This keeps the production
API private to the host, where Nginx exposes the existing HTTPS API and MCP
routes. The port and HTTP/WebSocket/MCP routes remain unchanged.

## Server bind address

Set `SERVER_BIND_ADDR` to a complete numeric socket address when a different
bind is required. It must keep port `8080`, so the existing API, WebSocket and
MCP routes stay on their documented port. The process fails at startup with a
clear error if its value is not a valid socket address or changes the port.

```bash
# Default; no variable is required.
cargo run -p server

# Explicit development-only LAN override. Do not use this for production.
SERVER_BIND_ADDR=0.0.0.0:8080 cargo run -p server
```

Production deployments must retain the loopback default unless the INF-002
network exposure review, health checks, rollback procedure and approval permit
a different bind. Do not add the override to a committed environment file.

## Database schema and SQLx metadata

For the current database structure, start with the generated, data-free catalog
at [`docs/generated/database-schema.md`](../../docs/generated/database-schema.md).
It is the compact human/LLM inspection view verified by CI; do not infer the
current schema by manually summarizing the migration history.

SQLx query metadata is committed at the repository root in `.sqlx/`. Regenerate
it only against a disposable PostgreSQL 17 database initialized through the
active SQLx migrations; never use a production `DATABASE_URL` for this. CI runs
the migration chain, verifies the generated catalog snapshot, seeds a controlled
test identity, checks committed metadata and runs database-backed server tests.
ARM compilation runs with `SQLX_OFFLINE=true` and no `DATABASE_URL`.

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/balance_sqlx
cargo sqlx migrate run --source apps/server/migrations
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file scripts/seed-test-user.sql
cargo sqlx prepare --workspace -- --all-targets
```

See `docs/database-migrations.md` before adding a migration or guiding a
production migration. Application startup intentionally never runs migrations.

## Database pool and MCP limits

`DB_MAX_CONNECTIONS` sets the maximum number of PostgreSQL connections per server
process. It defaults to 20 when unset and accepts ASCII decimal integers from 1
through 50. The shared pool sets its minimum to two connections (one when the
maximum is one) and allows five seconds to acquire a connection. Readiness
checks the same pool with a one-second deadline.

MCP admits up to six tool calls per user and up to the pool maximum minus two
globally, with a floor of one and a ceiling of 14. At the default pool size, the
14 execution slots leave six connections outside that budget. A one-connection
pool has no concurrent headroom. Cold authentication, REST, sync, and readiness
also use the shared pool. Running and waiting tool calls count toward enrollment
limits of 24 per user and 128 per process. A call has ten seconds to acquire both
execution permits. On overflow or admission timeout, the tool returns
`server_busy`.

Strict OIDC authentication verifies each token for its route and shares a
process-local cache of up to 4,096 positive issuer/subject mappings across the
API, MCP, and application WebSocket routes. A changed or deleted mapping may
still be served for up to 60 seconds after caching. An API restart clears the
cache.
