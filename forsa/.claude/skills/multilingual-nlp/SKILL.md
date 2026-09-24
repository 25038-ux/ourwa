---
name: multilingual-nlp
description: French/Arabic/English (later Hassaniya) normalisation, ontology terms and synonym curation.
---

# multilingual-nlp

1. Add terms to `taxonomy/data/capabilities.yaml` under the right concept and language; never rename ids.
2. Normalisation must preserve original offsets (`tokenize`) — test with `text[start:end] == quote`.
3. Add a case to `evals/multilingual/` for each new term family, including a negative (`not_concepts`).
4. Do not translate blindly: map surface forms to canonical concepts; record provenance for learned synonyms.
5. Only add UNSPSC/CPV codes after checking the official code lists.
