"""Multilingual text normalisation (French / Arabic / English).

Design goals:
* Tokens keep their character span in the *original* text so every concept hit
  can be cited verbatim (spec §9, source lineage).
* The same function normalises ontology terms and document text, so matching is
  symmetric.
* Deliberately light-weight (no stemmer dependency); good enough for curated
  synonym matching. Hassaniya/dialect handling is a future extension.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_ARABIC_DIACRITICS = re.compile("[ً-ْٰـ]")  # tashkeel + superscript alef + tatweel
_ARABIC_CHARS = re.compile("[؀-ۿ]")
_ARABIC_PREFIXES = ("وال", "بال", "فال", "كال", "لل", "ال")
_FR_ELISION = re.compile(r"^(?:l|d|j|qu|n|s|c|m|t)['’]", re.IGNORECASE)
_STOPWORDS = frozenset(
    {
        # fr
        "de",
        "des",
        "du",
        "la",
        "le",
        "les",
        "et",
        "en",
        "pour",
        "au",
        "aux",
        "un",
        "une",
        "a",
        "par",
        "sur",
        "dans",
        "avec",
        # en
        "the",
        "of",
        "and",
        "for",
        "to",
        "in",
        "on",
        "with",
        "an",
        # ar (after normalisation)
        "في",
        "من",
        "علي",
        "الي",
        "و",
    }
)


@dataclass(frozen=True, slots=True)
class Token:
    norm: str
    start: int
    end: int


def _strip_latin_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch) or _ARABIC_CHARS.match(ch))


def normalize_arabic(word: str) -> str:
    word = _ARABIC_DIACRITICS.sub("", word)
    word = re.sub("[إأآٱ]", "ا", word)
    word = word.replace("ى", "ي").replace("ة", "ه").replace("ؤ", "و").replace("ئ", "ي")
    for prefix in _ARABIC_PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) >= 3:
            word = word[len(prefix) :]
            break
    return word


def normalize_word(word: str) -> str:
    """Normalise a single word. Returns '' for stop-words."""
    word = word.casefold()
    word = _FR_ELISION.sub("", word)
    if _ARABIC_CHARS.search(word):
        word = normalize_arabic(word)
    else:
        word = _strip_latin_accents(word)
        # Light plural folding (fr/en): "panneaux" -> "panneau", "forages" -> "forage".
        is_aux_plural = len(word) > 4 and word.endswith("aux")
        is_plural = len(word) > 3 and word.endswith(("s", "x")) and not word.endswith("ss")
        if is_aux_plural or is_plural:
            word = word[:-1]
    return "" if word in _STOPWORDS else word


def tokenize(text: str) -> list[Token]:
    """Tokenise and normalise while preserving original character offsets."""
    tokens: list[Token] = []
    # Treat apostrophes as part of a word so French elisions are handled by normalize_word.
    for match in re.finditer(r"\w+(?:['’]\w+)?", text, re.UNICODE):
        norm = normalize_word(match.group(0))
        if norm:
            tokens.append(Token(norm, match.start(), match.end()))
    return tokens


def normalize_phrase(text: str) -> tuple[str, ...]:
    return tuple(t.norm for t in tokenize(text))


def normalize_key(text: str) -> str:
    """Normalised identity key (e.g. for buyer de-duplication)."""
    return " ".join(normalize_phrase(text))


def detect_language(text: str) -> str:
    """Very small script/lexicon heuristic: 'ar' | 'fr' | 'en' | 'und'."""
    if not text.strip():
        return "und"
    letters = [ch for ch in text if ch.isalpha()]
    if letters and sum(1 for ch in letters if _ARABIC_CHARS.match(ch)) / len(letters) > 0.3:
        return "ar"
    words = {w.casefold() for w in _TOKEN_RE.findall(text)}
    fr_hits = len(words & {"le", "la", "les", "des", "pour", "et", "du", "avis", "marché", "travaux", "fourniture"})
    en_hits = len(words & {"the", "and", "for", "of", "notice", "supply", "works", "services", "procurement"})
    if fr_hits == en_hits == 0:
        return "und"
    return "fr" if fr_hits >= en_hits else "en"
