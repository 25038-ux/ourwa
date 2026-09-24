# ADR-009: Human approval for consequential actions

**Status:** Accepted (2026-09-24)

## Context
Spec §39, §54, §72.

## Decision
Approval requests with a state machine; four-eyes when another approver exists; bid submission can only be *recorded* after approval; FORSA has no external submission capability; `submit_external` tool requires APPROVED.

## Alternatives considered
Trust-based UI confirmations.

## Consequences
Single-person organisations can self-approve (audited as `self_approval`).
