"""Portail National des Marchés Publics (Mauritania) — JSON API used by the public portal itself.

Verified 2026-09-24 (docs/research/source-registry.md): the public pages of https://marchespublics.gov.mr load their
data from unauthenticated JSON endpoints. No robots.txt (404 ⇒ no restrictions, RFC 9309); no login, CAPTCHA or
bot protection is involved. We read only what the public pages show, politely (registry rate limit).

Feeds:
* ``/api/annonces`` — published notices (title FR/AR, buyer, publication date, official PDF). The deadline is not a
  listing field: it is read from the PDF (OCR + ``documents/deadlines.py``).
* ``/api/activities/forSite`` — procurement-plan (PPM) lines: planned launch/award dates, method, category ⇒
  PLAN_ITEM early signals. Direct agreements (Entente directe) are skipped: nobody can bid on them.

Privacy: some endpoints embed portal-staff records (e-mail, phone, password hash). This connector builds records
from an explicit allow-list of fields and never stores the raw staff sub-objects.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

from forsa.ingestion.contracts import (
    DocumentRef,
    FieldEvidence,
    NormalizedOpportunity,
    RawRecord,
    SourceHealth,
    SourceRef,
)
from forsa.ingestion.http import PoliteHttpClient
from forsa.taxonomy.normalize import detect_language

CATEGORY = {
    "travaux": "works",
    "fournitures": "goods",
    "services courants": "services",
    "prestations intellectuelles": "consulting",
}
# Selection modes where no open competition takes place.
NON_COMPETITIVE = {"ED", "CDC"}


def _dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def notice_kind(title: str) -> tuple[str, str]:
    """(kind, status) from a notice title — the portal has no structured type on this feed.

    Real titles contain typos ("attibution", "INRUCTUEUX"), so stems are matched loosely.
    """
    t = title.casefold()
    if re.search(r"\bat+r?ibu(?:tion|é)", t) or re.search(r"r[ée]sultats?", t):
        return "AWARD", "PROVISIONAL_AWARD" if "provisoire" in t else "FINAL_AWARD"
    if "annulation" in t or re.search(r"in[fr]*uctueu", t):
        return "TENDER", "CANCELLED"
    if re.search(r"candidature interne|membres? de la commission|membres? du comit|recrutement des membres", t):
        return "INFO", "CLOSED"  # administrative call for individuals, not a business opportunity
    if re.search(r"additif|addendum|rectificatif|[ée]claircissement|clarification|report de (?:la )?date", t):
        return "TENDER", "CLARIFICATION"
    if "manifestation" in t or re.search(r"\bami\b", t):
        return "EOI", "PUBLISHED"
    if "cotation" in t or "demande de prix" in t or "consultation" in t:
        return "RFQ", "PUBLISHED"
    if "proposition" in t or "sollicitation" in t:
        return "RFP", "PUBLISHED"
    return "TENDER", "PUBLISHED"


class ArmpApiConnector:
    version = "armp-api-v1"

    def __init__(self, key: str, config: dict[str, Any], client: PoliteHttpClient, now: datetime | None = None):
        self.key = key
        self.base = str(config.get("base_url", "https://marchespublics.gov.mr")).rstrip("/")
        self.page_size = int(config.get("page_size", 50))
        self.max_pages = int(config.get("max_pages", 10))
        self.plan_page_size = int(config.get("plan_page_size", 100))
        self.plan_max_pages = int(config.get("plan_max_pages", 50))
        self.plan_window_days = int(config.get("plan_window_days", 365))
        self.plan_grace_days = int(config.get("plan_grace_days", 30))
        self.client = client
        self.now = now or datetime.now(UTC)
        self._totals: dict[str, int] = {}

    # ── discovery: one ref per listing page; page counts come from each feed's totalCount ──────────────────
    def _page_url(self, feed: str, offset: int, limit: int | None = None) -> str:
        path = "/api/annonces" if feed == "annonces" else "/api/activities/forSite"
        return f"{self.base}{path}?{urlencode({'limit': limit or self._size(feed), 'offset': offset})}"

    def _total(self, feed: str) -> int:
        if feed not in self._totals:
            res = self.client.get(self._page_url(feed, 0, limit=1))
            data = json.loads(res.content) if res.status == 200 else {}
            self._totals[feed] = int(data.get("totalCount") or 0)
        return self._totals[feed]

    def _size(self, feed: str) -> int:
        return self.page_size if feed == "annonces" else self.plan_page_size

    def discover(self) -> Iterable[SourceRef]:
        for feed, max_pages in (("annonces", self.max_pages), ("activities", self.plan_max_pages)):
            total, size = self._total(feed), self._size(feed)
            pages = min(max_pages, (total + size - 1) // size)
            for i in range(pages):
                yield SourceRef(url=self._page_url(feed, i * size), kind="listing", meta={"feed": feed})

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

    # ── parsing ───────────────────────────────────────────────────────────────────────────────────────────
    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]:
        data = json.loads(raw.content)
        if raw.ref.meta.get("feed") == "activities" or "activities" in data:
            return [o for a in data.get("activities", []) if (o := self._plan_item(a)) is not None]
        return [o for a in data.get("data", []) if (o := self._notice(a)) is not None]

    def _notice(self, a: dict[str, Any]) -> NormalizedOpportunity | None:
        title = (a.get("titreFr") or a.get("titreAr") or "").strip()
        if not a.get("_id") or not title or a.get("validated") not in (None, "Validé"):
            return None
        kind, status = notice_kind(title)
        buyer = (a.get("autorite") or {}).get("titlefr") or (a.get("autorite") or {}).get("titlear")
        file = a.get("file") or {}
        docs = []
        if isinstance(file.get("fileLink"), str) and file["fileLink"].startswith(f"{self.base}/api/files/"):
            docs.append(DocumentRef(url=file["fileLink"], title=(file.get("name") or "Avis")[:300]))
        attributes: dict[str, Any] = {"source_feed": "annonces"}
        if a.get("titreAr") and a.get("titreAr") != title:
            attributes["title_ar"] = a["titreAr"][:500]
        abbrev = (a.get("autorite") or {}).get("abreviation")
        if abbrev:
            attributes["buyer_code"] = abbrev
        return NormalizedOpportunity(
            external_ref=f"annonce:{a['_id']}",
            title=title[:1000],
            kind=kind,
            buyer_name=buyer,
            country="MR",
            currency="MRU",
            published_at=_dt(a.get("datePUB")),
            status=status,
            language=detect_language(title) or "fr",
            url=f"{self.base}/marchespublics/annonces",
            attributes=attributes,
            documents=docs,
            evidence={
                "title": FieldEvidence(title, "json:$.titreFr"),
                "buyer_name": FieldEvidence(buyer, "json:$.autorite.titlefr"),
                "published_at": FieldEvidence(a.get("datePUB"), "json:$.datePUB"),
            },
        )

    def _plan_item(self, a: dict[str, Any]) -> NormalizedOpportunity | None:
        title = (a.get("realisation") or "").strip()
        mode = a.get("modeselection") or {}
        if not a.get("_id") or not title or (mode.get("abreviation") or "").strip() in NON_COMPETITIVE:
            return None
        launch = _dt(a.get("datelancement"))
        if launch is None or not (
            self.now - timedelta(days=self.plan_grace_days)
            <= launch
            <= self.now + timedelta(days=self.plan_window_days)
        ):
            return None
        ppm = a.get("ppm") or {}
        if ppm.get("validated") not in (None, "Validé"):
            return None
        authorities = a.get("autorites") or []
        buyer = (authorities[0].get("titlefr") or authorities[0].get("titlear")) if authorities else None
        cat = ((a.get("types") or {}).get("titre") or "").strip().casefold()
        amount = (a.get("montant") or {}).get("montantMRU") or None
        attributes = {
            "source_feed": "ppm_activities",
            "planned_launch": launch.date().isoformat(),
            "planned_award": (_dt(a.get("dateattribution")) or launch).date().isoformat(),
            "plan_reference": (ppm.get("reference") or "")[:200] or None,
            "method_code": (mode.get("abreviation") or "").strip() or None,
        }
        return NormalizedOpportunity(
            external_ref=f"ppm-activity:{a['_id']}",
            title=title[:1000],
            kind="PLAN_ITEM",
            description=f"Ligne du plan de passation des marchés {ppm.get('annee', '')} — lancement prévu le "
            f"{attributes['planned_launch']} ({(mode.get('titre') or '').strip()}).",
            buyer_name=buyer,
            country="MR",
            category=CATEGORY.get(cat),
            method=(mode.get("titre") or "").strip()[:80] or None,
            currency="MRU",
            estimated_value=float(amount) if amount else None,
            published_at=_dt(ppm.get("datePUB")),
            status="PLANNED",
            language="fr",
            url=f"{self.base}/marchespublics/ppm",
            attributes={k: v for k, v in attributes.items() if v},
            evidence={
                "title": FieldEvidence(title, "json:$.realisation"),
                "method": FieldEvidence(mode.get("titre"), "json:$.modeselection.titre"),
                "attributes": FieldEvidence(a.get("datelancement"), "json:$.datelancement"),
            },
        )

    def health_check(self) -> SourceHealth:
        try:
            return SourceHealth.UP if self._total("annonces") > 0 else SourceHealth.DEGRADED
        except Exception:
            return SourceHealth.DOWN


def parse_red_list(content: bytes, base_url: str = "https://marchespublics.gov.mr") -> list[dict[str, Any]]:
    """ARMP « liste rouge » (companies excluded from public procurement) → allow-listed fields only."""
    out = []
    for item in json.loads(content):
        name = (item.get("entreprise") or "").strip()
        if not item.get("_id") or not name:
            continue
        link = (item.get("file") or {}).get("fileLink")
        out.append(
            {
                "external_ref": item["_id"],
                "entity_name": name[:300],
                "registry_number": (item.get("nrc") or "").strip()[:80] or None,
                "nature": (item.get("nature") or "").strip() or None,
                "reference": (item.get("reference") or "").strip() or None,
                "effective_date": _dt(item.get("dateEffet")),
                "document_url": link if isinstance(link, str) and link.startswith(f"{base_url}/api/files/") else None,
            }
        )
    return out
