# ADR-007: Tenant isolation with FORCEd row-level security

**Status:** Accepted (2026-09-24)

## Context
Commercially sensitive company data; spec §61 wants protection beyond the frontend.

## Decision
Tenant tables use FORCE RLS keyed on `current_setting('forsa.org_id')`, set per transaction from session info; system work sets `forsa.system`. No context ⇒ no rows. Services also filter by org_id.

## Alternatives considered
Application-only filtering; schema-per-tenant.

## Consequences
A missed filter cannot leak data. The DB role must not be a superuser; public (org_id NULL) rows are readable by all tenants but writable only by the system.
