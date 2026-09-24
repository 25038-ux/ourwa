"""United Nations Global Marketplace — official Notice API (developer.ungm.org), OAuth 2.0.

Verified 2026-09-24 against the Developer Center articles (Ping, GetNotices, RefreshAccessToken, Notice CSDL):
* ``GET https://www.ungm.org/API/Notices`` (OData: ``value`` + ``@odata.nextLink``) requires a *user* access token
  (Authorization Code Grant). Tokens: ``POST https://www.ungm.org/API/token`` with ``grant_type=refresh_token``;
  every refresh returns a new single-use refresh token (unused for 6 months ⇒ expires).
* Credentials are issued by the UNGM Secretariat (client id/secret) for a UNGM user — contact eprocurement@ungm.org.
  Without them this connector reports AUTH_REQUIRED and never falls back to scraping the website.

Notice fields used (CSDL): Id, Type, Title, Reference, TimeZone, Description, TypeOfCompetition, CountryISO3Codes,
DatePublished, Deadline, Status. Only ``RequestForEoi`` and ``NotSet`` are documented examples of ``Type``; other
values are mapped by keyword and default to TENDER (to verify with real responses).
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from forsa.ingestion.connectors.worldbank import html_text
from forsa.ingestion.contracts import FieldEvidence, NormalizedOpportunity, RawRecord, SourceHealth, SourceRef
from forsa.ingestion.http import PoliteHttpClient

BASE = "https://www.ungm.org"
REQUIRED_ENV = ("UNGM_CLIENT_ID", "UNGM_CLIENT_SECRET", "UNGM_REFRESH_TOKEN")


class CredentialsMissing(RuntimeError):
    pass


def _dt(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def notice_kind(value: str | None) -> str:
    v = (value or "").lower()
    if "eoi" in v or "interest" in v:
        return "EOI"
    if "proposal" in v:
        return "RFP"
    if "quotation" in v:
        return "RFQ"
    return "TENDER"


class UngmApiConnector:
    version = "ungm-api-v1"

    def __init__(self, key: str, config: dict[str, Any], client: PoliteHttpClient, state_dir: Path):
        self.key = key
        self.country3 = config.get("country_iso3", "MRT")
        self.country = config.get("country", "MR")
        self.max_pages = int(config.get("max_pages", 20))
        self.client = client
        self.state_file = state_dir / f"{key}.refresh_token"
        self._token: str | None = None

    # ── OAuth (refresh-token rotation, persisted with 0600 permissions) ─────────────────────────────────────
    def _refresh_token(self) -> str:
        if self.state_file.exists():
            saved = self.state_file.read_text(encoding="utf-8").strip()
            if saved:
                return saved
        return os.environ.get("UNGM_REFRESH_TOKEN", "")

    def _access_token(self) -> str:
        if self._token:
            return self._token
        client_id, secret = os.environ.get("UNGM_CLIENT_ID"), os.environ.get("UNGM_CLIENT_SECRET")
        refresh = self._refresh_token()
        if not (client_id and secret and refresh):
            raise CredentialsMissing("UNGM API credentials are not configured (UNGM_CLIENT_ID/SECRET/REFRESH_TOKEN)")
        res = self.client.post_form(
            f"{BASE}/API/token",
            {"grant_type": "refresh_token", "refresh_token": refresh, "client_id": client_id, "client_secret": secret},
        )
        if res.status != 200:
            raise CredentialsMissing(f"UNGM token refresh failed (HTTP {res.status}); request new credentials")
        data = json.loads(res.content)
        if data.get("refresh_token"):
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(data["refresh_token"], encoding="utf-8")
            self.state_file.chmod(0o600)
        self._token = data["access_token"]
        return self._token

    def _get(self, url: str) -> Any:
        res = self.client.get(
            url, headers={"Authorization": f"bearer {self._access_token()}", "Accept": "application/json"}
        )
        if res.status != 200:
            raise RuntimeError(f"HTTP {res.status} for {url}")
        return res

    # ── connector contract ─────────────────────────────────────────────────────────────────────────────────
    def discover(self) -> Iterable[SourceRef]:
        # OData paging: each page names the next one, so pages are discovered while fetching.
        yield SourceRef(url=f"{BASE}/API/Notices", kind="listing", meta={"page": 0})

    def fetch(self, ref: SourceRef) -> RawRecord:
        pages: list[Any] = []
        url: str | None = ref.url
        while url and len(pages) < self.max_pages:
            data = json.loads(self._get(url).content)
            pages.extend(data.get("value", []))
            url = data.get("@odata.nextLink")
        relevant = [n for n in pages if self.country3 in (n.get("CountryISO3Codes") or [])]
        content = json.dumps({"value": relevant}, ensure_ascii=False, sort_keys=True).encode()
        return RawRecord(ref, content, "application/json", datetime.now(UTC), ref.url)

    def parse(self, raw: RawRecord) -> list[NormalizedOpportunity]:
        return [o for n in json.loads(raw.content).get("value", []) if (o := self.notice(n)) is not None]

    def notice(self, n: dict[str, Any]) -> NormalizedOpportunity | None:
        if not n.get("Id") or not n.get("Title") or (n.get("Status") or "").lower() == "deleted":
            return None
        title = str(n["Title"]).strip()
        return NormalizedOpportunity(
            external_ref=f"ungm:{n['Id']}",
            title=title[:1000],
            kind=notice_kind(n.get("Type")),
            description=html_text(n.get("Description"))[:20000] or None,
            country=self.country,
            method=(n.get("TypeOfCompetition") or "")[:80] or None,
            published_at=_dt(n.get("DatePublished")),
            deadline_at=_dt(n.get("Deadline")),
            status="PUBLISHED",
            url=f"{BASE}/Public/Notice/{n['Id']}",
            attributes={k: v for k, v in {"reference": n.get("Reference"), "unspsc": n.get("UnspscIds")}.items() if v},
            evidence={
                "title": FieldEvidence(title, "json:$.Title"),
                "deadline_at": FieldEvidence(n.get("Deadline"), "json:$.Deadline"),
            },
        )

    def health_check(self) -> SourceHealth:
        try:
            self._access_token()
            return SourceHealth.UP
        except CredentialsMissing:
            return SourceHealth.AUTH_REQUIRED
        except Exception:
            return SourceHealth.DOWN
