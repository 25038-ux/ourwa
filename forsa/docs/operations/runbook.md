# Runbook

## Local stack
```bash
make setup && make demo        # or: docker compose up --build
make api / make worker / make web
```
PostgreSQL role for the app: owner of the database, **not superuser** (RLS would be bypassed).

## Routine operations
| Task | Command |
|---|---|
| Apply migrations | `forsa db-upgrade` |
| Sync registry → DB | `forsa sources-sync` |
| Run a source now | `forsa ingest <source-id>` (API: `POST /api/v1/admin/sources/{key}/run`, platform admin) |
| Drain queue once | `forsa worker --once` |
| Recompute all matches (after scoring change) | `forsa rematch` |
| Run evals | `forsa eval` |
| Create a user/org | `FORSA_NEW_USER_PASSWORD=… forsa create-user --email … --org <slug> --role OWNER` |

## Alerts & responses
- **Source not UP > 12 h** (briefing "source alert", `/sources`): check `ingestion_runs.error`; if the portal
  layout changed, update the registry `column_map` with new parser fixtures + tests; never bypass blocks.
- **BLOCKED**: robots.txt/terms/registry status forbids access — escalate to a human; do not work around it.
- **DEAD jobs** (`/api/v1/admin/ingestion`): read `last_error`; fix root cause; re-enqueue by running the
  source or `forsa rematch`. Jobs are idempotent.
- **AI budget exceeded**: calls return `budget_exceeded`; product falls back to deterministic output.

## Backups (to set up with the first deployment)
Managed PostgreSQL with PITR; object storage versioning; **quarterly restore test** — record date and result
here. A backup that has never been restored is not proven.

| Date | Restore test | Result |
|---|---|---|
| — | not yet performed | — |
