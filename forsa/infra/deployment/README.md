# Deployment baseline (not yet deployed)

FORSA runs as **one image, two roles** (API + worker) plus the web app and PostgreSQL.
Migrations live in `backend/migrations` (Alembic) and run as a one-shot `forsa db-upgrade` job.

Production checklist (spec §102–109) — each item must be verified, not assumed:

- [ ] Managed PostgreSQL 16 with PITR backups; **restore test performed** and dated in `docs/operations/runbook.md`.
- [ ] App DB role is the schema owner but **not a superuser** (superusers bypass row-level security).
- [ ] `FORSA_ENV=prod`, `FORSA_JWT_SECRET` from the secret manager, `FORSA_COOKIE_SECURE=true`, HTTPS only.
- [ ] Object storage: S3-compatible bucket with versioning (implement `ObjectStore` adapter; local FS is dev-only).
- [ ] Malware scanning adapter wired before accepting uploads from external users (uploads are `NOT_SCANNED` today).
- [ ] Web and API behind the same origin (Next.js rewrite or reverse proxy) so the session cookie stays first-party.
- [ ] Log shipping for JSON stdout logs; alert on `DEAD` jobs and on any active source not `UP` for > 12 h.
- [ ] Dependency scan, secret scan and SAST in CI before release.
- [ ] Source registry entries for every enabled connector reviewed (terms, robots.txt, licence) — see
      `docs/research/source-registry.md`.
