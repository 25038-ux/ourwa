#!/usr/bin/env bash
# Restore a nightly backup:  ./restore.sh backups/forsa-YYYYMMDD-HHMM.dump
set -euo pipefail
cd "$(dirname "$0")"
[[ -f "${1:-}" ]] || { echo "usage: ./restore.sh backups/forsa-….dump"; exit 1; }
set -a; source .env; set +a
docker compose -f docker-compose.prod.yml stop api worker web
docker compose -f docker-compose.prod.yml exec -T -e PGPASSWORD="$POSTGRES_ADMIN_PASSWORD" db \
  pg_restore -U postgres -d forsa --clean --if-exists --no-owner --role=forsa < "$1"
docker compose -f docker-compose.prod.yml start api worker web
echo "Restored $1"
