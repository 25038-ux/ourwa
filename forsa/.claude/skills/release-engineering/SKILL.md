---
name: release-engineering
description: Prepare a release or deployment: migrations, config, checks, rollback.
---

# release-engineering

1. `make check` green; CI green on the branch.
2. Migrations reviewed, additive, tested up/down/up; note them in `docs/project-state.md`.
3. Prod config: `FORSA_ENV=prod`, secrets from the secret manager, `FORSA_COOKIE_SECURE=true`, non-superuser DB role.
4. Rollback plan: previous image + backward-compatible schema.
5. Follow `infra/deployment/README.md`; record the release in the decision log.
