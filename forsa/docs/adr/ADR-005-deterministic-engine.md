# ADR-005: Deterministic engine, provider-neutral AI gateway at the edges

**Status:** Accepted (2026-09-24)

## Context
LLM output is untrusted and non-reproducible; the spec forbids AI-invented eligibility.

## Decision
Matching stages A–F are a pure function with a version string. AI (optional) may extract proposals (INFERENCE) or re-word explanations; re-wordings adding numbers are rejected. All calls go through `AIGateway` (routing by tier, budgets, caching, recording, fallback).

## Alternatives considered
LLM-scored matching; direct SDK calls from features.

## Consequences
Reproducible and testable; works with no model; vendor-neutral. Less 'magic' prose until AI features are enabled by flag.
