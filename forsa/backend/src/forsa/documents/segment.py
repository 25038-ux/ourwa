"""Structure-aware segmentation (spec §21): split by heading/clause, not by token count."""

from __future__ import annotations

import re
from dataclasses import dataclass

from forsa.documents.extract import Page
from forsa.kernel.hashing import sha256_bytes

_HEADING = re.compile(
    r"^\s*(?:(?:article|section|chapitre|titre|annexe|lot|partie|clause|المادة|الفصل|الباب)\s+[\w.\-]+"
    r"|\d+(?:\.\d+){0,3}[.)]?\s+\S.{0,80}$"
    r"|[A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9 '’\-:]{3,80}$)",
    re.IGNORECASE | re.UNICODE,
)
_SENTENCE = re.compile(r"(?:[^.;!?؟\n]|[.;!?؟](?=[^\s.;!?؟]))+(?:[.;!?؟]+|$)", re.UNICODE)


@dataclass(frozen=True, slots=True)
class Segment:
    page: int
    heading_path: tuple[str, ...]
    text: str
    start: int  # char offset within the page text
    end: int
    kind: str  # heading | clause

    @property
    def content_hash(self) -> str:
        return sha256_bytes(self.text.encode("utf-8"))

    @property
    def locator(self) -> str:
        section = " › ".join(self.heading_path) if self.heading_path else "—"
        return f"p.{self.page} § {section}"


def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 100 or stripped.endswith((".", ";", ",")):
        return False
    return bool(_HEADING.match(stripped))


def _heading_level(line: str) -> int:
    m = re.match(r"^\s*(\d+(?:\.\d+)*)", line)
    if m:
        return m.group(1).count(".") + 2
    letters = [c for c in line if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        return 0  # document / part title
    return 1  # Article, Section, Chapitre …


def segment_pages(pages: list[Page]) -> list[Segment]:
    segments: list[Segment] = []
    path: list[tuple[int, str]] = []
    for page in pages:
        offset = 0
        for line in page.text.splitlines(keepends=True):
            start = offset
            offset += len(line)
            content = line.strip()
            if not content:
                continue
            lead = start + (len(line) - len(line.lstrip()))
            if _is_heading(content):
                level = _heading_level(content)
                path = [(lvl, h) for lvl, h in path if lvl < level]
                path.append((level, content))
                segments.append(
                    Segment(page.number, tuple(h for _, h in path), content, lead, lead + len(content), "heading")
                )
                continue
            for m in _SENTENCE.finditer(line):
                sentence = m.group(0).strip()
                if len(sentence) < 3:
                    continue
                s_start = start + m.start() + (len(m.group(0)) - len(m.group(0).lstrip()))
                segments.append(
                    Segment(
                        page.number, tuple(h for _, h in path), sentence, s_start, s_start + len(sentence), "clause"
                    )
                )
    return segments
