# Security architecture

| Control | Implementation |
|---|---|
| Tenant isolation | FORCEd RLS on tenant tables, fail-closed when no context; `org_id` filters in services; cross-tenant tests (`tests/integration/test_tenancy_and_queue.py`, `test_api.py`). App DB role must not be superuser. |
| Authorization | Roles from `memberships` (DB) on every request; permissions in `identity/rbac.py`; never from client claims or token contents. |
| Authentication | scrypt password hashes (stdlib); HS256 session token in an httpOnly, SameSite=Lax cookie (Secure in prod); login rate limit (per process). |
| CSRF | Unsafe methods with cookie auth require `X-Requested-With: forsa` (cross-site requests cannot set it without a CORS preflight). |
| Headers | nosniff, frame DENY, no-referrer, `Cache-Control: no-store, no-transform` and restrictive CSP on API responses; web sets `Permissions-Policy: microphone=(self)` (voice) and nothing else. |
| Uploads | Size cap, magic-byte type validation (PDF, DOCX, HTML, text; ZIP archives refused), content-addressed storage, injection flags, `scan_status=NOT_SCANNED` until a malware scanner adapter exists. |
| SSRF | Connector HTTP client allowlist + private-address refusal + no redirects. No agent has a generic network tool. |
| Prompt injection | Untrusted boundaries, injection detection, rewording validation, tools least-privilege. |
| Human approval | Approval state machine, four-eyes, `submit_external` gated. Assistant actions are proposals the user clicks. |
| AI data governance | Per-call sensitivity (public/internal/confidential) vs per-provider ceiling; raising a ceiling requires a recorded DPA review; keys env-only; budgets per tenant (ADR-011). |
| Live stream | `/api/v1/live` authenticates with the session cookie and filters events by org **and** user; NOTIFY carries ids/titles only, details go through RLS. |
| Invitations | 32-byte random tokens, only the SHA-256 is stored, single use, 7-day expiry, revocable; existing accounts must prove their password. |
| Web Push | VAPID private key env-only; subscriptions are per user (RLS); dead endpoints pruned. |
| Audit | `audit_events` for logins (incl. failures), company changes, uploads, bid decisions, approvals, submissions, outcomes. |
| Secrets | Environment only (`.env.example`); prod refuses to start without explicit `FORSA_JWT_SECRET` and secure cookies. |

## Known gaps (tracked in project-state)
Malware scanning adapter · login rate limit is per-process · no MFA yet · no data export/deletion endpoints
yet (privacy §104) · dependency/secret scanning and SAST not yet in CI.
