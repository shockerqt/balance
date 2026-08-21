#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if ! command -v pg_virtualenv >/dev/null 2>&1; then
  echo "pg_virtualenv is required to generate the schema snapshot safely" >&2
  exit 2
fi

env BALANCE_SNAPSHOT_REPO="$repo_root" pg_virtualenv -v 17 bash -lc '
  set -euo pipefail
  cd "$BALANCE_SNAPSHOT_REPO"
  createdb balance_schema_snapshot
  cargo sqlx migrate run \
    --source apps/server/migrations \
    --database-url postgresql:///balance_schema_snapshot
  DATABASE_URL=postgresql:///balance_schema_snapshot \
    scripts/render-schema-snapshot.sh
'
