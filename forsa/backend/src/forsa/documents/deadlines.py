"""Find the submission deadline stated in a notice (FR / AR / EN), with the exact quote.

Many portals (e.g. the Mauritanian PNMP) publish notices as PDFs whose listing carries no deadline field. The
deadline is a sentence such as « Les offres devront être déposées au plus tard le Mardi 01/09/2026 à 12h 00 TU ».
This module is pure (no I/O) and conservative: a date is only returned when it sits next to a submission anchor
and not next to an opening/publication phrase. Unknown stays unknown (the engine then shows "deadline unknown").
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from forsa.documents.extract import Page

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

MONTHS = {
    # French (accents stripped by _fold)
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
    "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    # English
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11,
    "dec": 12,
    # Arabic (Mashriq + Maghreb names)
    "يناير": 1, "جانفي": 1, "فبراير": 2, "فيفري": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "أفريل": 4, "افريل": 4,
    "مايو": 5, "ماي": 5, "يونيو": 6, "جوان": 6, "يوليو": 7, "جويلية": 7, "يوليوز": 7, "أغسطس": 8, "اغسطس": 8,
    "أوت": 8, "اوت": 8, "غشت": 8, "سبتمبر": 9, "شتنبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11,
    "نونبر": 11, "ديسمبر": 12, "دجنبر": 12,
}  # fmt: skip

ANCHORS = (
    "au plus tard", "date limite", "delai de depot", "delai de remise", "delai de soumission", "doivent etre deposees",
    "devront etre deposees", "doivent etre remises", "devront etre remises", "doivent parvenir", "devront parvenir",
    "depot des offres", "remise des offres", "depot des propositions", "depot des manifestations",
    "deadline", "no later than", "not later than", "must be delivered", "must be submitted",
    "آخر أجل", "آخر اجل", "أقصاه", "اقصاه", "إيداع", "ايداع", "تودع", "تقدم العروض",
)  # fmt: skip
# Common words that only count when a submission subject (offres, bids, العروض…) is also nearby.
WEAK_ANCHORS = ("avant le", "submission", "submitted", "قبل")
SUBJECTS = ("offre", "proposition", "manifestation", "candidature", "pli", "dossier", "soumission", "bid",
            "proposal", "expression", "application", "العروض", "الملفات", "العرض")  # fmt: skip
EXCLUSIONS = ("ouverture", "opening", "publie", "published", "fait suite", "en date du", "validite", "valables",
              "valid for", "فتح", "نشر")  # fmt: skip

_MONTH_ALT = "|".join(sorted((re.escape(m) for m in MONTHS), key=len, reverse=True))
_DATE_PATTERNS = (
    # 01/09/2026, 01-09-2026, 01.09.2026, "01/09/ 2026" (OCR spacing)
    ("dmy", re.compile(r"(?<!\d)(\d{1,2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(20\d{2})(?!\d)")),
    # 2026/09/01, 2026-09-01
    ("ymd", re.compile(r"(?<!\d)(20\d{2})\s?[/.\-]\s?(\d{1,2})\s?[/.\-]\s?(\d{1,2})(?!\d)")),
    # 20 août 2026, 1er octobre 2026, 15 أكتوبر 2026
    ("d_month_y", re.compile(rf"(?<!\d)(\d{{1,2}})(?:er|st|nd|rd|th)?\s+({_MONTH_ALT})\.?,?\s+(20\d{{2}})", re.I)),
    # October 7, 2026
    ("month_d_y", re.compile(rf"\b({_MONTH_ALT})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(20\d{{2}})", re.I)),
)
_TIME = re.compile(
    r"^\W{0,4}(?:à|a|at|,|ـ|على\s+الساعة|الساعة)?\s*(\d{1,2})\s*(?:h|heures?|H|:)\s*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?",
    re.I,
)


@dataclass(frozen=True, slots=True)
class DeadlineHit:
    deadline: datetime
    has_time: bool
    quote: str
    page: int
    start: int  # character offsets in the page text
    end: int
    score: int


def _fold(text: str) -> str:
    """Lowercase, strip Latin accents, map Arabic-Indic digits — lengths preserved for offsets."""
    out = []
    for ch in text.translate(_ARABIC_DIGITS):
        base = unicodedata.normalize("NFD", ch)[0] if ord(ch) < 0x0600 else ch
        out.append(base.lower() if len(base.lower()) == 1 else ch)
    return "".join(out)


def _build(kind: str, m: re.Match[str]) -> tuple[int, int, int] | None:
    g = m.groups()
    try:
        if kind == "dmy":
            return int(g[2]), int(g[1]), int(g[0])
        if kind == "ymd":
            return int(g[0]), int(g[1]), int(g[2])
        if kind == "d_month_y":
            return int(g[2]), MONTHS[g[1].lower()], int(g[0])
        return int(g[2]), MONTHS[g[0].lower()], int(g[1])
    except (KeyError, ValueError):
        return None


def _score(before: str, near: str) -> int:
    score = 0
    anchor_pos = max((before.rfind(a) for a in ANCHORS), default=-1)
    if anchor_pos >= 0:
        score += 3 if len(before) - anchor_pos <= 90 else 2
    elif any(0 <= len(before) - before.rfind(a) <= 60 for a in WEAK_ANCHORS if a in before):
        score += 2
    if any(s in before[-160:] for s in SUBJECTS):
        score += 1
    if any(x in near for x in EXCLUSIONS):
        score -= 4
    return score


def find_deadline(pages: list[Page], utc_offset_hours: float = 0.0) -> DeadlineHit | None:
    """Best submission-deadline candidate across pages, or None. Mauritania is UTC+0 all year."""
    best: DeadlineHit | None = None
    for page in pages:
        folded = _fold(page.text)
        for kind, pattern in _DATE_PATTERNS:
            for m in pattern.finditer(folded):
                ymd = _build(kind, m)
                if ymd is None:
                    continue
                year, month, day = ymd
                if not (2000 <= year <= 2100):
                    continue
                before = folded[max(0, m.start() - 220) : m.start()]
                near = folded[max(0, m.start() - 60) : m.start()]
                score = _score(before, near)
                if score < 3:
                    continue
                hour, minute, has_time = 12, 0, False
                tm = _TIME.match(folded[m.end() : m.end() + 40])
                if tm and tm.group(1) and int(tm.group(1)) <= 23:
                    hour, minute, has_time = int(tm.group(1)), int(tm.group(2) or 0), True
                    if (tm.group(3) or "").startswith("p") and hour < 12:
                        hour += 12
                try:
                    local = datetime(year, month, day, hour, min(minute, 59), tzinfo=UTC)
                except ValueError:
                    continue
                deadline = local - timedelta(hours=utc_offset_hours)
                s0 = max(0, page.text.rfind(".", 0, max(0, m.start() - 1)) + 1, m.start() - 200)
                e0 = min(len(page.text), m.end() + 40)
                quote = " ".join(page.text[s0:e0].split())
                hit = DeadlineHit(deadline, has_time, quote, page.number, s0, e0, score)
                if best is None or hit.score > best.score:
                    best = hit
    return best
