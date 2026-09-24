"""World Bank procurement notices — official Search API (`search.worldbank.org/api/v2/procnotices`).

Verified 2026-09-24: public JSON API, no authentication; dataset "World Bank Procurement Notices" (data catalog
0037795) is licensed CC BY 4.0 — attribute "World Bank" when displaying. Filter: ``project_ctry_name_exact``.

* Open calls (Invitation for Bids / Request for Expression of Interest / Prequalification) → opportunities with the
  structured submission deadline (date + local time).
* Contract Awards → AWARD records for market intelligence (winners, signed price). Winners of individual-consultant
  contracts are recorded as "individual" without a name (personal data minimisation).
* Contact persons (name, e-mail, phone) are never stored; the official notice link carries them.
* The notice text is the description; requirements are extracted from it with snapshot citations.
"""

from __future__ import annotations

import html
import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from forsa.ingestion.contracts import (
    FieldEvidence,
    NormalizedOpportunity,
    RawRecord,
    SourceHealth,
    SourceRef,
)
from forsa.ingestion.http import PoliteHttpClient

API = "https://search.worldbank.org/api/v2/procnotices"
NOTICE_URL = "https://projects.worldbank.org/en/projects-operations/procurement-detail/{id}"
KIND = {
    "invitation for bids": ("TENDER", "PUBLISHED"),
    "request for expression of interest": ("EOI", "PUBLISHED"),
    "invitation for prequalification": ("TENDER", "PUBLISHED"),
    "request for proposals": ("RFP", "PUBLISHED"),
    "general procurement notice": ("PLAN_ITEM", "PLANNED"),
    "contract award": ("AWARD", "FINAL_AWARD"),
}
CATEGORY = {"GO": "goods", "CW": "works", "CS": "consulting", "NC": "services"}
LANG = {"french": "fr", "english": "en", "arabic": "ar", "spanish": "es", "portuguese": "pt"}
_INDIVIDUAL = re.compile(
    r"consultant\(?e?\)?\s+individuel|individual consultant|recrutement d.(?:un|une)\s+"
    r"(?:assistante?|experte?|sp[ée]cialiste|coordonnat\w*|comptable|juriste)\b",
    re.I,
)
_OTHERS = r"(?:(?:Evaluated|Rejected) (?:Bidder|Firm|Consultant)\(s\)|(?:Bidder|Firm)\(s\) not)"
_CONTACT = re.compile(r"(t[ée]l|tel|phone|email|e-mail|bp|fax)\s*[:.].*", re.I)


def html_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    text = re.sub(r"</(p|div|li|tr|h\d)>", "\n", text, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t ]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def _amount(text: str) -> tuple[str | None, float | None]:
    m = re.search(r"\b([A-Z]{3})\s*([\d][\d,\s]*(?:\.\d+)?)", text)
    if not m:
        return None, None
    try:
        return m.group(1), float(re.sub(r"[,\s]", "", m.group(2)))
    except ValueError:
        return m.group(1), None


def parse_award(text: str, individual: bool) -> list[dict[str, Any]]:
    """Winners from a Contract Award notice text (World Bank template)."""
    m = re.search(rf"Awarded (?:Firm|Bidder)\(s\)\s*:?(.*?)(?:{_OTHERS}|$)", text, re.S)
    if not m:
        return []
    block = m.group(1)
    winners = []
    for part in re.split(r"\n(?=[^\n]*\(\d{3,}\)\s*\n)", "\n" + block.strip()):
        lines = [ln.strip() for ln in part.strip().splitlines() if ln.strip()]
        if not lines:
            continue
        name = re.sub(r"\s*\(\d+\)\s*$", "", lines[0]).strip(" .")
        country = next((ln.split(":", 1)[1].strip() for ln in lines if ln.lower().startswith("country")), None)
        price_line = ""
        for i, ln in enumerate(lines):
            if re.search(r"signed contract price|contract price", ln, re.I):
                price_line = " ".join(lines[i : i + 2])
        currency, amount = _amount(price_line)
        if not name or _CONTACT.match(name):
            continue
        winners.append(
            {
                "name": None if individual else _CONTACT.sub("", name)[:200].strip() or None,
                "type": "individual" if individual else "firm",
                "country": country[:80] if country else None,
                "currency": currency,
                "amount": amount,
            }
        )
    return winners


def other_bidders(text: str) -> list[str]:
    """Names of evaluated/rejected firms (competitors who also bid). Firms only; no prices kept."""
    names: list[str] = []
    for m in re.finditer(rf"{_OTHERS}\s*:?(.*?)(?=(?:{_OTHERS})|$)", text, re.S):
        for line in m.group(1).splitlines():
            hit = re.match(r"\s*(.+?)\s*\(\d{3,}\)\s*$", line)
            if hit and not _CONTACT.match(hit.group(1)):
                names.append(hit.group(1).strip(" .")[:200])
    return list(dict.fromkeys(names))


def _date(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    for fmt in ("%d-%b-%Y", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


class WorldBankConnector:
    version = "worldbank-api-v1"

    def __init__(self, key: str, config: dict[str, Any], client: PoliteHttpClient):
        self.key = key
        self.country_name = config.get("country_name", "Mauritania")
        self.country = config.get("country", "MR")
        self.rows = int(config.get("rows", 100))
        self.max_pages = int(config.get("max_pages", 10))
        self.utc_offset_hours = float(config.get("utc_offset_hours", 0))
        self.client = client
        self._total: int | None = None

    def _url(self, offset: int, rows: int | None = None) -> str:
        q = {
            "format": "json",
            "rows": rows or self.rows,
            "os": offset,
            "project_ctry_name_exact": self.country_name,
            "srt": "noticedate",
            "order": "desc",
        }
        return f"{API}?{urlencode(q)}"

    def total(self) -> int:
        if self._total is None:
            res = self.client.get(self._url(0, rows=1))
            self._total = int(json.loads(res.content).get("total") or 0) if res.status == 200 else 0
        return self._total

    def discover(self) -> Iterable[SourceRef]:
        pages = min(self.max_pages, (self.total() + self.rows - 1) // self.rows)
        for i in range(pages):
            yield SourceRef(url=self._url(i * self.rows), kind="listing")

    def fetch(self, ref: SourceRef) -> RawRecord:
        res = self.client.get(ref.url)
        if res.status != 200:
            raise RuntimeError(f"HTTP {res.status} for {ref.url}")
        return RawRecord(
            ref=ref,
            content=res.content,
            content_type=res.content_type,
            retrieved_at=datetime.now(UTC),
            canonical_url=ref.url,
            etag=res.etag,
            last_modified=res.last_modified,
        )

    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]:
        data = json.loads(raw.content)
        return [o for n in data.get("procnotices", []) if (o := self.notice(n)) is not None]

    def notice(self, n: dict[str, Any]) -> NormalizedOpportunity | None:
        if not n.get("id") or (n.get("notice_status") or "Published") != "Published":
            return None
        kind, status = KIND.get((n.get("notice_type") or "").strip().lower(), ("TENDER", "PUBLISHED"))
        title = (n.get("bid_description") or n.get("project_name") or "").strip()
        if not title:
            return None
        text = html_text(n.get("notice_text"))
        deadline = None
        day = _date(n.get("submission_deadline_date"))
        if day and kind not in ("AWARD", "PLAN_ITEM"):
            hh, mm = 12, 0
            tm = re.match(r"(\d{1,2}):(\d{2})", n.get("submission_deadline_time") or "")
            if tm:
                hh, mm = int(tm.group(1)), int(tm.group(2))
            deadline = day.replace(hour=min(hh, 23), minute=min(mm, 59)) - timedelta(hours=self.utc_offset_hours)
        group = n.get("procurement_group")
        method_code = n.get("procurement_method_code")
        attributes: dict[str, Any] = {
            "project_id": n.get("project_id"),
            "project_name": (n.get("project_name") or "")[:300] or None,
            "reference": (n.get("bid_reference_no") or "")[:200] or None,
            "method_code": method_code,
            "notice_type": n.get("notice_type"),
        }
        value = currency = None
        if kind == "AWARD":
            individual = method_code == "INDV" or bool(_INDIVIDUAL.search(title))
            winners = parse_award(text, individual)
            attributes["winners"] = winners
            if not individual:
                attributes["other_bidders"] = other_bidders(text)
            signed = [w for w in winners if w.get("amount")]
            if signed and len({w["currency"] for w in signed}) == 1:
                currency, value = signed[0]["currency"], sum(w["amount"] for w in signed)
            award_date = re.search(r"Date Notification of Award Issued.*?(\d{4})/(\d{2})/(\d{2})", text, re.S)
            if award_date:
                attributes["award_date"] = "-".join(award_date.groups())
        buyer = (n.get("contact_organization") or "").strip() or (
            f"{n.get('project_name')} (World Bank project)" if n.get("project_name") else None
        )
        url = NOTICE_URL.format(id=n["id"])
        return NormalizedOpportunity(
            external_ref=n["id"],
            title=title[:1000],
            kind=kind,
            description=text[:20000] or None,
            buyer_name=buyer[:300] if buyer else None,
            country=self.country,
            category=CATEGORY.get(group or ""),
            method=(n.get("procurement_method_name") or "")[:80] or None,
            funding_source=f"World Bank — {n.get('project_id')}"[:200] if n.get("project_id") else "World Bank",
            currency=currency,
            estimated_value=value,
            published_at=_date(n.get("noticedate")),
            deadline_at=deadline,
            status=status,
            language=LANG.get((n.get("notice_lang_name") or "").lower()),
            url=url,
            attributes={k: v for k, v in attributes.items() if v not in (None, "", [])},
            evidence={
                "title": FieldEvidence(title, "json:$.bid_description"),
                "deadline_at": FieldEvidence(
                    f"{n.get('submission_deadline_date')} {n.get('submission_deadline_time') or ''}".strip(),
                    "json:$.submission_deadline_date+submission_deadline_time",
                ),
                "published_at": FieldEvidence(n.get("noticedate"), "json:$.noticedate"),
                "status": FieldEvidence(n.get("notice_type"), "json:$.notice_type"),
            },
        )

    def health_check(self) -> SourceHealth:
        try:
            return SourceHealth.UP if self.total() > 0 else SourceHealth.DEGRADED
        except Exception:
            return SourceHealth.DOWN
