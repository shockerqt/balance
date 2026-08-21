#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_path=${1:-"$repo_root/docs/generated/database-schema.md"}
database_url=${DATABASE_URL:-}

if [[ -z "$database_url" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

database_name=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')
if [[ "$database_name" == "meal_logger" && "${ALLOW_PRODUCTION_SCHEMA_SNAPSHOT:-}" != "true" ]]; then
  echo "refusing to render the checked-in snapshot from production meal_logger" >&2
  exit 3
fi

catalog=$(
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c default_transaction_read_only=on" \
    psql "$database_url" -X -v ON_ERROR_STOP=1 -At \
      -f "$repo_root/scripts/schema-catalog.sql"
)
fingerprint=$(printf '%s\n' "$catalog" | sha256sum | awk '{print $1}')
postgres_version=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc "SELECT current_setting('server_version')")

ledger_exists=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
if [[ "$ledger_exists" == "t" ]]; then
  migration_head=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT version::text || ' ' || description || ' checksum=' || encode(checksum, 'hex') FROM _sqlx_migrations WHERE success ORDER BY version DESC LIMIT 1")
else
  migration_head=untracked
fi

mkdir -p "$(dirname "$output_path")"
snapshot_tmp=$(mktemp)
trap 'rm -f "$snapshot_tmp"' EXIT

{
  echo '<!-- GENERATED FILE: do not edit manually. Run `make schema-snapshot`. -->'
  echo '# Balance database schema snapshot'
  echo
  echo "- PostgreSQL major: ${postgres_version%%.*}"
  echo "- Migration head: \`$migration_head\`"
  echo "- Schema fingerprint: \`sha256:$fingerprint\`"
  echo
  echo 'The active SQLx migrations are the source of truth. This data-free catalog'
  echo 'is generated for human and LLM inspection and is verified by CI.'
  echo
  echo '```text'
  printf '%s\n' "$catalog"
  echo '```'
} >"$snapshot_tmp"

install -m 0644 "$snapshot_tmp" "$output_path"
