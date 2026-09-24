# ADR-003: Hybrid retrieval, ontology first

**Status:** Accepted (2026-09-24)

## Context
Spec §22 requires hybrid retrieval, not vector-only.

## Decision
Retrieval today = metadata filters + trigram/ILIKE + multilingual ontology matching with cited spans. Vector similarity and reranking are added behind the same interface later.

## Alternatives considered
Vector-only RAG from day one.

## Consequences
Deterministic, explainable concept hits with exact quotes. Semantic recall for unseen phrasing is limited until embeddings arrive — tracked by the multilingual eval suite.
