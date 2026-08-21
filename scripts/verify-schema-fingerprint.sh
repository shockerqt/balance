#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
snapshot_path=${1:-"$repo_root/docs/generated/database-schema.md"}
database_url=${DATABASE_URL:-}

if [[ -z "$database_url" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

expected=$(sed -n 's/^- Schema fingerprint: `sha256:\([0-9a-f]\{64\}\)`$/\1/p' "$snapshot_path")
if [[ -z "$expected" ]]; then
  echo "snapshot does not contain one canonical schema fingerprint" >&2
  exit 3
fi

actual=$(DATABASE_URL="$database_url" "$repo_root/scripts/schema-fingerprint.sh")
database_name=$(psql "$database_url" -X -v ON_ERROR_STOP=1 -Atc 'SELECT current_database()')

if [[ "$actual" != "$expected" ]]; then
  echo "schema fingerprint mismatch for $database_name" >&2
  echo "expected sha256:$expected" >&2
  echo "actual   sha256:$actual" >&2
  exit 1
fi

echo "schema fingerprint verified for $database_name: sha256:$actual"
