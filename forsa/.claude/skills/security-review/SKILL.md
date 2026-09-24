---
name: security-review
description: Security review of a change: tenancy, authz, uploads, SSRF, prompt injection, secrets.
---

# security-review

1. Tenant data: RLS table? org_id filter? cross-tenant test?
2. AuthZ: permission checked server-side via `ctx.require(...)`? Roles from DB only?
3. Inputs: pydantic limits, file validation, no raw SQL string building.
4. Network: only `PoliteHttpClient`; no user-controlled URLs fetched.
5. AI: untrusted boundaries, no tool escalation, `submit_external` gated.
6. Secrets: none in code, logs, memory files or fixtures. Update `docs/architecture/security.md`.
