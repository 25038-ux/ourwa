"""Declarative HTML-table listing connector.

Many procurement portals publish notices as HTML tables. Instead of hard-coding
one site, the column → field mapping lives in the source registry, so adapting
to a layout change is a reviewed config change, not a code change (spec §25,
"resilient to source changes").

IMPORTANT: the ARMP mapping in sources/registry.yaml is *unverified* until the
Phase 0 inspection is done; the pipeline refuses to run non-active sources.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

from forsa.ingestion.contracts import FieldEvidence, NormalizedOpportunity, RawRecord, SourceHealth, SourceRef
from forsa.ingestion.http import PoliteHttpClient
from forsa.taxonomy.normalize import detect_language, normalize_key


class _Tables(HTMLParser):
    """Collect every <table> as rows of (text, first-href) cells."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[tuple[str, str | None]]]] = []
        self._row: list[tuple[str, str | None]] | None = None
        self._cell: list[str] | None = None
        self._href: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self.tables.append([])
        elif tag == "tr" and self.tables:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell, self._href = [], None
        elif tag == "a" and self._cell is not None and self._href is None:
            self._href = dict(attrs).get("href")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append((" ".join("".join(self._cell).split()), self._href))
            self._cell = None
        elif tag == "tr" and self._row is not None and self.tables:
            if self._row:
                self.tables[-1].append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def parse_date(value: str, formats: list[str]) -> datetime | None:
    value = value.strip()
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def parse_amount(value: str) -> float | None:
    digits = re.sub(r"[^\d,.]", "", value)
    if not digits:
        return None
    digits = digits.replace(" ", "")
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", digits):
        return float(re.sub(r"[.,]", "", digits))
    try:
        return float(digits.replace(",", "."))
    except ValueError:
        return None


class HtmlTableConnector:
    version = "html-table-v1"

    def __init__(self, key: str, config: dict[str, Any], http: PoliteHttpClient | None, country: str | None):
        self.key = key
        self.cfg = config
        self.http = http
        self.country = country
        self.column_map: dict[str, str] = {normalize_key(k): v for k, v in config.get("column_map", {}).items()}
        self.date_formats: list[str] = config.get("date_formats", ["%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d"])
        self.value_maps: dict[str, dict[str, str]] = {
            field: {normalize_key(k): v for k, v in mapping.items()}
            for field, mapping in (config.get("value_maps") or {}).items()
        }

    def discover(self) -> Iterable[SourceRef]:
        template = self.cfg["listing_url"]
        for page in range(1, int(self.cfg.get("max_pages", 1)) + 1):
            yield SourceRef(url=template.format(page=page), kind="listing", meta={"page": page})

    def fetch(self, ref: SourceRef) -> RawRecord:
        if self.http is None:
            raise RuntimeError("no HTTP client configured")
        res = self.http.get(ref.url)
        return RawRecord(
            ref=ref,
            content=res.content,
            content_type=res.content_type,
            retrieved_at=res.retrieved_at,  # type: ignore[arg-type]
            canonical_url=ref.url,
            etag=res.etag,
            last_modified=res.last_modified,
        )

    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]:
        parser = _Tables()
        parser.feed(raw.content.decode("utf-8", errors="replace"))
        out: list[NormalizedOpportunity] = []
        for table in parser.tables:
            if not table:
                continue
            header = [normalize_key(text) for text, _ in table[0]]
            fields = [self.column_map.get(h) for h in header]
            if "external_ref" not in fields or "title" not in fields:
                continue
            for row_no, row in enumerate(table[1:], start=1):
                values: dict[str, str] = {}
                evidence: dict[str, FieldEvidence] = {}
                link: str | None = None
                for col, (text, href) in enumerate(row):
                    if col >= len(fields) or not fields[col]:
                        continue
                    name = fields[col]
                    assert name is not None
                    values[name] = text
                    evidence[name] = FieldEvidence(quote=text, locator=f"table row {row_no} › col '{table[0][col][0]}'")
                    if href and link is None:
                        link = urljoin(raw.canonical_url, href)
                if not values.get("external_ref") or not values.get("title"):
                    continue
                out.append(self._normalize(values, evidence, link))
        return out

    def _mapped(self, field: str, value: str | None) -> str | None:
        if value is None:
            return None
        return self.value_maps.get(field, {}).get(normalize_key(value), value)

    def _normalize(self, v: dict[str, str], ev: dict[str, FieldEvidence], link: str | None) -> NormalizedOpportunity:
        return NormalizedOpportunity(
            external_ref=v["external_ref"],
            title=v["title"],
            kind=self._mapped("kind", v.get("kind")) or "TENDER",
            description=v.get("description"),
            buyer_name=v.get("buyer_name"),
            country=self.country,
            region=v.get("region"),
            category=self._mapped("category", v.get("category")),
            method=v.get("method"),
            currency=self.cfg.get("currency"),
            estimated_value=parse_amount(v["estimated_value"]) if v.get("estimated_value") else None,
            published_at=parse_date(v.get("published_at", ""), self.date_formats),
            deadline_at=parse_date(v.get("deadline_at", ""), self.date_formats),
            status=self._mapped("status", v.get("status")) or "PUBLISHED",
            language=detect_language(v["title"]),
            url=link,
            evidence=ev,
        )

    def health_check(self) -> SourceHealth:
        return SourceHealth.UP if self.http is not None else SourceHealth.DOWN
