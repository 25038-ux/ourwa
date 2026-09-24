---
paths:
  - "backend/migrations/**"
  - "backend/src/forsa/db/models.py"
---
# Migration rules
- Schema changes go through Alembic (`alembic revision --autogenerate`, then review by hand).
- Once a migration is deployed it is frozen: add a new one. Prefer additive, backwards-compatible changes.
- New tenant tables must be added to `TENANT_TABLES` / `SHARED_OR_TENANT_TABLES` and get RLS policies in the
  migration, plus a cross-tenant test.
- Never name a column `registry`, `metadata` or other `DeclarativeBase` attributes.
- Verify `upgrade → downgrade → upgrade` locally.
