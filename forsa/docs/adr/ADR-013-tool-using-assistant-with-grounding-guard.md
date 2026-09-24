# ADR-013: Tool-using assistant (text + voice) with a grounding guard

**Status:** Accepted (2026-09-24)

## Context
Users want to ask FORSA questions in French, English or Arabic — typed or spoken — and get answers they can
trust, plus help acting (open a bid, create a task). An LLM answering from memory would invent tenders.

## Decision
* The assistant (`assistant/`) answers **only** through tenant-scoped, read-only tools: search/filter
  opportunities, top recommendations, deadlines, opportunity detail, explanation, requirements, company profile,
  briefing, consented partner search. Tools run under the caller's RLS context.
* Actions are **proposed** (`propose_action` → cards in the UI); a human clicks to execute through the normal
  API. The assistant never executes consequential actions (ADR-009).
* With a provider: an LLM tool loop (max 5 steps). Without one: a deterministic multilingual planner calls
  the same tools and composes the answer — the assistant always works.
* **Grounding guard**: if an LLM answer contains numbers absent from the tool results, it is discarded and the
  deterministic composition is returned instead.
* Transport: SSE events `meta → tool → delta → final`; conversations are stored per user (RLS).
* Voice: browser Web Speech API for dictation and speech output (no audio leaves the device through FORSA).

## Alternatives considered
RAG-only chat (no structured filters, weak numbers); server-side speech (cost, privacy, latency).

## Consequences
Answers cite the opportunities they come from. Speech recognition quality depends on the browser (Chrome/Edge/
Safari support it; Firefox does not). Arabic TTS depends on installed voices.
