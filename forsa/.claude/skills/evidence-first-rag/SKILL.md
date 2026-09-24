---
name: evidence-first-rag
description: Retrieval and citation work: evidence/assertions tables, 'why do you say this?', hybrid retrieval, grounding AI outputs.
---

# evidence-first-rag

1. Every externally sourced fact needs an `evidence` row (source, locator, quote, hash, retrieved_at) and an
   `assertions` row (epistemic, confidence, verification).
2. Retrieval order: metadata filters → lexical/trigram → ontology concepts → (later) vectors → rerank → validate.
3. AI answers must cite evidence ids they were given; reject outputs citing anything else.
4. Distinguish "not found" from "does not exist" in every answer.
5. Test with a question whose answer is absent — the correct output is "unknown".
