# Memory layers (spec §45)

Never mix these layers.

| Level | What | Where |
|---|---|---|
| 1 Project memory | Stable instructions & architecture for Claude Code | `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `docs/` (esp. `docs/project-state.md`) — Claude Code auto-memory lives outside the repo |
| 2 Application configuration | Company preferences, feature flags | `companies` columns, env `FORSA_FEATURES` |
| 3 Company knowledge | Documents and approved knowledge | `documents` / `document_versions` / `evidence` (org-scoped) |
| 4 Opportunity memory | Opportunity history | `opportunity_versions`, `opportunity_events`, `assertions` |
| 5 Outcome memory | Bid decisions, outcomes, lessons | `bid_decisions`, `bids.outcome`, `feedback` |
| 6 Model memory | Prompt/model performance | `ai_requests`, `match_history`, eval reports |

This directory holds nothing sensitive. Never store secrets or customer data here.
