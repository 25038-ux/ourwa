#!/usr/bin/env bash
# Bring the whole stack up, seed it, and run the browser suite — in ONE process
# tree, so nothing is left half-running if the caller goes away.
#
# `pnpm dev` is the everyday command; this exists because the E2E suite needs
# the stack to be up AND seeded AND still alive when Playwright starts, which is
# three things that are easy to get wrong by hand.
set -uo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.npm-global:$PATH"
export DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:5432/elourwa"
export DATABASE_URL="postgres://app_user:devpassword@localhost:5432/elourwa"
export NEXT_PUBLIC_API_URL="http://localhost:3001"
export PWTEST_HEADLESS=1

LOG=/tmp/e2e
mkdir -p "$LOG"
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT

wait_for() { # wait_for <name> <command> <seconds>
  local name=$1 probe=$2 limit=${3:-180} waited=0
  until eval "$probe" >/dev/null 2>&1; do
    sleep 3; waited=$((waited + 3))
    if [ "$waited" -ge "$limit" ]; then echo "TIMEOUT waiting for $name"; return 1; fi
  done
  echo "  $name up (${waited}s)"
}

# Free the ports first. A stale `next dev` or API from an earlier run answers
# health checks perfectly well while serving code from hours ago — which looks
# exactly like a broken application and wastes a great deal of time. Kill, then
# start, rather than trusting that "something answers".
echo "== Ports =="
for port in 3000 3001; do
  pid=$(powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ' '" 2>/dev/null | tr -d '
')
  for one in $pid; do
    [ -n "$one" ] && taskkill //F //PID "$one" >/dev/null 2>&1 && echo "  freed port $port (pid $one)"
  done
done

echo "== Postgres =="
# An orphaned postmaster from a killed run keeps its shared memory block and
# makes the next start fail with "pre-existing shared memory block is still in
# use". Clear it before starting rather than leaving the next run to puzzle
# over it.
if ! (cd packages/db && node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL,connectionTimeoutMillis:2000});try{await c.connect();await c.end();process.exit(0)}catch(e){process.exit(1)}})()" >/dev/null 2>&1); then
  taskkill //F //IM postgres.exe >/dev/null 2>&1 || true
  rm -f packages/db/.devdata/postmaster.pid 2>/dev/null || true
  sleep 2
fi

pnpm --filter @elourwa/db db:dev > "$LOG/pg.log" 2>&1 &
pids+=($!)
# A TCP probe is not enough: Postgres opens its port well before it will accept
# a connection, so a socket check reports "up" and the very next command fails
# with BackendInitialize. Wait for an actual successful query.
# `require('pg')` does NOT resolve from the repo root in a pnpm workspace —
# dependencies live under the package that declares them. Both probes below run
# from packages/db for that reason.
wait_for "postgres" "(cd packages/db && node -e \"const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});try{await c.connect();await c.query('SELECT 1');await c.end();process.exit(0)}catch(e){process.exit(1)}})()\")" 300 || { tail -15 "$LOG/pg.log"; exit 1; }

echo "== Seed =="
# Only seed when empty: re-seeding on every run would discard whatever the
# previous run recorded, and the suite is meant to survive that.
students=$(cd packages/db && node -e "
const pg=require('pg');(async()=>{try{const c=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});await c.connect();
const r=await c.query('SELECT count(*)::int n FROM students');console.log(r.rows[0].n);await c.end();}catch(e){console.log(0)}})()
" 2>/dev/null || echo 0)
if [ "${students:-0}" -lt 100 ]; then
  echo "  seeding (found ${students:-0} students)"
  pnpm --filter @elourwa/db seed > "$LOG/seed.log" 2>&1 || { tail -5 "$LOG/seed.log"; exit 1; }
else
  echo "  already seeded ($students students)"
fi
# L'école « services » de développement (Jinan) : relançable, remise à neuf à
# chaque passage — ses tests encaissent, arrêtent et réinscrivent.
pnpm --filter @elourwa/db seed:jinan > "$LOG/seed-jinan.log" 2>&1 || { tail -5 "$LOG/seed-jinan.log"; exit 1; }
echo "  Jinan (dév.) remise à neuf"

echo "== API =="
pnpm --filter @elourwa/api dev > "$LOG/api.log" 2>&1 &
pids+=($!)
wait_for "api" "curl -sf -m 2 http://localhost:3001/health | grep -q ok" 240 || { tail -10 "$LOG/api.log"; exit 1; }

echo "== Web =="
pnpm --filter @elourwa/web dev > "$LOG/web.log" 2>&1 &
pids+=($!)
wait_for "web" "curl -sf -m 3 -H 'Host: nour.localhost:3000' http://127.0.0.1:3000/login" 300 || { tail -10 "$LOG/web.log"; exit 1; }

echo "== Playwright =="
pnpm --filter @elourwa/web exec playwright test --reporter=line 2>&1 | tail -40
exit ${PIPESTATUS[0]}
