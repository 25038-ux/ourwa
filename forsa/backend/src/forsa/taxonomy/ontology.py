"""Canonical capability ontology + multilingual synonym index (spec §10–11).

Storage-agnostic domain object: loaded from the curated YAML seed today, from
the ``taxonomy_*`` tables later, without changing callers (ADR-006).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from forsa.taxonomy.normalize import normalize_phrase, tokenize

_DATA = Path(__file__).parent / "data" / "capabilities.yaml"


@dataclass(frozen=True, slots=True)
class Concept:
    id: str
    labels: dict[str, str]
    parent: str | None = None
    kind: str = "capability"  # capability | credential
    obtainable_days: int | None = None
    per_bid: bool = False
    codes: dict[str, list[str]] = field(default_factory=dict)

    def label(self, lang: str = "fr") -> str:
        return self.labels.get(lang) or self.labels.get("en") or self.id


@dataclass(frozen=True, slots=True)
class ConceptHit:
    """A concept found in text, with the exact span that justifies it."""

    concept_id: str
    term: str
    lang: str
    start: int
    end: int
    quote: str
    provenance: str


class Ontology:
    def __init__(self, raw: dict[str, Any]):
        self.version: str = raw.get("version", "unknown")
        self.provenance: str = raw.get("provenance", "unknown")
        self.concepts: dict[str, Concept] = {}
        self._index: dict[tuple[str, ...], tuple[str, str, str]] = {}
        self._max_len = 1
        for kind, key in (("capability", "concepts"), ("credential", "credentials")):
            for item in raw.get(key, []) or []:
                concept = Concept(
                    id=item["id"],
                    labels=item.get("labels", {}),
                    parent=item.get("parent"),
                    kind=kind,
                    obtainable_days=item.get("obtainable_days"),
                    per_bid=bool(item.get("per_bid", False)),
                    codes=item.get("codes", {}) or {},
                )
                if concept.id in self.concepts:
                    raise ValueError(f"duplicate concept id {concept.id}")
                self.concepts[concept.id] = concept
                surfaces: list[tuple[str, str]] = [(lang, lbl) for lang, lbl in concept.labels.items()]
                for lang, terms in (item.get("terms") or {}).items():
                    surfaces.extend((lang, t) for t in terms)
                for lang, term in surfaces:
                    phrase = normalize_phrase(str(term))
                    if not phrase:
                        continue
                    # First registration wins; more specific concepts are listed after their parent,
                    # so let a child override a parent for an identical surface form.
                    existing = self._index.get(phrase)
                    if existing is None or self.is_ancestor(existing[0], concept.id):
                        self._index[phrase] = (concept.id, lang, str(term))
                    self._max_len = max(self._max_len, len(phrase))
        for c in self.concepts.values():
            if c.parent and c.parent not in self.concepts:
                raise ValueError(f"concept {c.id} has unknown parent {c.parent}")

    # ── hierarchy ───────────────────────────────────────────────────────────
    def ancestors(self, concept_id: str) -> list[str]:
        out: list[str] = []
        current = self.concepts.get(concept_id)
        while current and current.parent:
            out.append(current.parent)
            current = self.concepts.get(current.parent)
        return out

    def is_ancestor(self, maybe_ancestor: str, concept_id: str) -> bool:
        return maybe_ancestor in self.ancestors(concept_id)

    def similarity(self, required: str, offered: str) -> float:
        """How well an *offered* company capability covers a *required* concept.

        exact = 1.0; company is more specific than the need = 0.85; company is
        more generic = 0.6; siblings under a shared non-root parent = 0.3.
        """
        if required == offered:
            return 1.0
        if self.is_ancestor(required, offered):
            return 0.85
        if self.is_ancestor(offered, required):
            return 0.6
        req, off = self.concepts.get(required), self.concepts.get(offered)
        if req and off and req.parent and req.parent == off.parent:
            return 0.3
        return 0.0

    # ── text → concepts ─────────────────────────────────────────────────────
    def find(self, text: str, kinds: tuple[str, ...] = ("capability",)) -> list[ConceptHit]:
        """Greedy longest-match of ontology terms in ``text``; spans index the original text."""
        tokens = tokenize(text)
        hits: list[ConceptHit] = []
        i = 0
        while i < len(tokens):
            matched = False
            for size in range(min(self._max_len, len(tokens) - i), 0, -1):
                key = tuple(t.norm for t in tokens[i : i + size])
                entry = self._index.get(key)
                if entry and self.concepts[entry[0]].kind in kinds:
                    start, end = tokens[i].start, tokens[i + size - 1].end
                    hits.append(ConceptHit(entry[0], entry[2], entry[1], start, end, text[start:end], self.provenance))
                    i += size
                    matched = True
                    break
            if not matched:
                i += 1
        return hits

    def concepts_in(self, text: str) -> dict[str, list[ConceptHit]]:
        grouped: dict[str, list[ConceptHit]] = {}
        for hit in self.find(text):
            grouped.setdefault(hit.concept_id, []).append(hit)
        return grouped

    def search(self, query: str, limit: int = 10) -> list[Concept]:
        """Prefix search over labels/terms for UI pickers."""
        q = normalize_phrase(query)
        if not q:
            return []
        scored: dict[str, int] = {}
        for phrase, (cid, _lang, _term) in self._index.items():
            if all(any(p.startswith(w) for p in phrase) for w in q):
                scored[cid] = min(scored.get(cid, 99), len(phrase))
        return [self.concepts[c] for c, _ in sorted(scored.items(), key=lambda kv: kv[1])][:limit]


@lru_cache(maxsize=1)
def default_ontology() -> Ontology:
    with _DATA.open(encoding="utf-8") as fh:
        return Ontology(yaml.safe_load(fh))
