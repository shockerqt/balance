#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
database_url=${DATABASE_URL:-}

if [[ -z "$database_url" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

catalog=$(
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c default_transaction_read_only=on" \
    psql "$database_url" -X -v ON_ERROR_STOP=1 -At \
      -f "$repo_root/scripts/schema-catalog.sql"
)

printf '%s\n' "$catalog" | sha256sum | awk '{print $1}'
