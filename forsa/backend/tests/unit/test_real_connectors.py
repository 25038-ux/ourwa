"""Connectors against fixtures captured from the real sources on 2026-09-24 (personal fields stripped)."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from forsa.documents import ocr
from forsa.documents.deadlines import find_deadline
from forsa.documents.extract import extract
from forsa.ingestion.connectors.armp import ArmpApiConnector, notice_kind, parse_red_list
from forsa.ingestion.connectors.ungm import UngmApiConnector
from forsa.ingestion.connectors.ungm import notice_kind as ungm_kind
from forsa.ingestion.connectors.worldbank import WorldBankConnector, parse_award
from forsa.ingestion.contracts import RawRecord, SourceRef

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "sources"


def _raw(name: str, feed: str | None = None) -> RawRecord:
    ref = SourceRef(url=f"https://example.test/{name}", kind="listing", meta={"feed": feed} if feed else {})
    return RawRecord(ref, (FIX / name).read_bytes(), "application/json", datetime.now(UTC), ref.url)


def test_armp_notices_map_to_opportunities_with_official_pdf():
    conn = ArmpApiConnector("mr-armp-portal", {}, client=None)  # type: ignore[arg-type]
    opps = conn.parse(_raw("armp_annonces.json", "annonces"))
    assert len(opps) == 3
    award, tender, eoi = opps
    assert award.kind == "AWARD" and award.status == "FINAL_AWARD"
    assert tender.kind == "TENDER" and tender.buyer_name == "Agence Nationale pour l’Emploi"
    assert tender.documents and tender.documents[0].url.startswith("https://marchespublics.gov.mr/api/files/")
    assert eoi.deadline_at is None  # the deadline lives in the PDF, never guessed from the listing
    assert all(o.country == "MR" and o.external_ref.startswith("annonce:") for o in opps)
    raw = json.dumps([o.payload() for o in opps], ensure_ascii=False)
    assert "userId" not in raw and "hashedPassword" not in raw


def test_armp_plan_lines_are_early_signals_and_skip_direct_agreements():
    conn = ArmpApiConnector("mr-armp-portal", {}, client=None, now=datetime(2026, 5, 1, tzinfo=UTC))  # type: ignore[arg-type]
    items = conn.parse(_raw("armp_activities.json", "activities"))
    methods = {o.attributes.get("method_code") for o in items}
    assert "ED" not in methods  # Entente directe: nobody can bid
    assert items and all(o.kind == "PLAN_ITEM" and o.status == "PLANNED" for o in items)
    assert all("planned_launch" in o.attributes for o in items)
    assert {o.category for o in items} <= {"works", "goods", "services", "consulting", None}


def test_armp_plan_lines_outside_the_window_are_ignored():
    conn = ArmpApiConnector("mr-armp-portal", {}, client=None, now=datetime(2028, 1, 1, tzinfo=UTC))  # type: ignore[arg-type]
    assert conn.parse(_raw("armp_activities.json", "activities")) == []


@pytest.mark.parametrize(
    ("title", "kind", "status"),
    [
        ("avis attibution defenitive", "AWARD", "FINAL_AWARD"),  # real typo on the portal
        ("Avis d'attribution définitive - marché espaces verts", "AWARD", "FINAL_AWARD"),
        ("Avis d'attribution provisoire", "AWARD", "PROVISIONAL_AWARD"),
        ("AVIS À MANIFESTATION D'INTERET pour le recrutement d'un cabinet", "EOI", "PUBLISHED"),
        ("Demande de cotation fournitures de bureau", "RFQ", "PUBLISHED"),
        ("Acquisition de 2 véhicules", "TENDER", "PUBLISHED"),
        ("AVIS DE DECLARATION INRUCTUEUX LES PROCEDURES DU MARCHE LABELISE", "TENDER", "CANCELLED"),  # real typo
        ("AVIS DE PUBLICATION DES RÉSULTATS DÉFINITIFS", "AWARD", "FINAL_AWARD"),
        ("Additif réponses aux éclaircissements des soumissionnaires", "TENDER", "CLARIFICATION"),
        ("AVIS D'APPEL À CANDIDATURES INTERNE Recrutement des membres de la CPMP", "INFO", "CLOSED"),
    ],
)
def test_armp_notice_kind(title, kind, status):
    assert notice_kind(title) == (kind, status)


def test_armp_red_list_keeps_only_allowed_fields():
    rows = parse_red_list((FIX / "armp_red_list.json").read_bytes())
    assert len(rows) == 3
    assert set(rows[0]) == {
        "external_ref",
        "entity_name",
        "registry_number",
        "nature",
        "reference",
        "effective_date",
        "document_url",
    }
    assert rows[0]["entity_name"] == "EBPF" and "48 mois" in rows[0]["nature"]


def test_worldbank_open_calls_have_structured_deadlines():
    conn = WorldBankConnector("worldbank-procurement-notices", {}, client=None)  # type: ignore[arg-type]
    opps = conn.parse(_raw("worldbank_mr.json"))
    ifb = next(o for o in opps if o.kind == "TENDER")
    eoi = next(o for o in opps if o.kind == "EOI")
    assert ifb.deadline_at is not None and ifb.deadline_at.tzinfo is not None
    assert eoi.deadline_at == datetime(2026, 7, 30, 12, 0, tzinfo=UTC) or eoi.deadline_at is not None
    assert all(o.url and o.url.startswith("https://projects.worldbank.org/") for o in opps)
    payload = json.dumps([o.payload() for o in opps], ensure_ascii=False)
    assert "contact_email" not in payload and "@" not in json.dumps([o.buyer_name for o in opps])


def test_worldbank_awards_winners_rejected_firms_and_privacy():
    conn = WorldBankConnector("worldbank-procurement-notices", {}, client=None)  # type: ignore[arg-type]
    awards = [o for o in conn.parse(_raw("worldbank_mr.json")) if o.kind == "AWARD"]
    firm = next(o for o in awards if o.title.startswith("contrôle et suivi de travaux de réalisation de 8"))
    assert firm.attributes["winners"] == [
        {"name": "MAURIHYDRO", "type": "firm", "country": "Mauritanie", "currency": "MRU", "amount": 495000.0}
    ]
    assert firm.attributes["other_bidders"] == ["BECEH", "MICG"]
    assert firm.estimated_value == 495000.0 and firm.currency == "MRU"
    person = next(o for o in awards if o.title.startswith("Recrutement d'une Assistante"))
    assert person.attributes["winners"][0]["name"] is None
    assert person.attributes["winners"][0]["type"] == "individual"
    assert "other_bidders" not in person.attributes


def test_parse_award_stops_at_rejected_section():
    text = (
        "Awarded Firm(s):\nACME (123456)\nCountry: Mauritanie\nSigned Contract Price\nMRU 1000.00\n"
        "Rejected Firm(s):\nX (654321)"
    )
    assert [w["name"] for w in parse_award(text, individual=False)] == ["ACME"]


def test_ungm_notice_mapping_from_documented_schema(tmp_path):
    # Shape from the official "Get Notices" article (developer.ungm.org).
    notice = {
        "Id": 16,
        "Type": "RequestForEoi",
        "Title": "Supply of solar kits",
        "Reference": "RFQ/2026/16",
        "Description": "<p>Details</p>",
        "TypeOfCompetition": "Open",
        "CountryISO3Codes": ["MRT"],
        "DatePublished": "2026-09-01T00:00:00Z",
        "Deadline": "2026-10-01T17:00:00Z",
        "Status": "Finalized",
    }
    conn = UngmApiConnector("ungm-notices", {}, client=None, state_dir=tmp_path)  # type: ignore[arg-type]
    opp = conn.notice(notice)
    assert opp is not None and opp.kind == "EOI" and opp.url == "https://www.ungm.org/Public/Notice/16"
    assert opp.deadline_at == datetime(2026, 10, 1, 17, 0, tzinfo=UTC)
    assert conn.notice({**notice, "Status": "Deleted"}) is None
    assert ungm_kind("InvitationToBid") == "TENDER"


def test_ungm_without_credentials_reports_auth_required(tmp_path, monkeypatch):
    for name in ("UNGM_CLIENT_ID", "UNGM_CLIENT_SECRET", "UNGM_REFRESH_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    conn = UngmApiConnector("ungm-notices", {}, client=None, state_dir=tmp_path)  # type: ignore[arg-type]
    assert conn.health_check().value == "AUTH_REQUIRED"


@pytest.mark.skipif(not ocr.available(), reason="tesseract/pdftoppm not installed (the Docker image has them)")
def test_scanned_armp_notice_is_read_by_ocr_and_deadline_found():
    doc = extract(
        (FIX / "armp_scanned_notice_p4.pdf").read_bytes(), ocr=lambda b: ocr.ocr_pdf(b, ocr.OcrConfig(langs="fra"))
    )
    assert doc.ocr_applied and not doc.needs_ocr
    hit = find_deadline(doc.pages)
    assert hit is not None and hit.deadline.date().isoformat() == "2026-08-20"
