import json
import shutil
from pathlib import Path

from sqlalchemy import func, select

from forsa.db.models import (
    IngestionRun,
    Opportunity,
    OpportunityEvent,
    OpportunityVersion,
    Source,
    SourceSnapshot,
)
from forsa.db.session import system_session
from forsa.ingestion.connectors.fixture import FixtureConnector
from forsa.ingestion.pipeline import IngestionPipeline
from forsa.ingestion.storage import LocalObjectStore
from forsa.jobs.worker import run_until_idle
from forsa.settings import get_settings

DEMO = get_settings().fixtures_dir / "demo" / "notices"


def _source(s, status="active") -> Source:
    src = Source(
        key="test-src",
        name="t",
        country="MR",
        category="demo",
        access_type="synthetic_fixture",
        status=status,
        connector="fixture",
        registry_entry={},
    )
    s.add(src)
    s.flush()
    return src


def _run(tmp: Path, status="active") -> IngestionRun:
    with system_session() as s:
        src = s.scalar(select(Source).where(Source.key == "test-src")) or _source(s, status)
        run = IngestionPipeline(s, LocalObjectStore(tmp / "store")).run(
            src, FixtureConnector("test-src", tmp / "in"), synthetic=True
        )
        s.flush()
        s.expunge(run)
        return run


def _count(model) -> int:
    with system_session() as s:
        return s.scalar(select(func.count()).select_from(model))


def test_ingestion_is_idempotent_and_versions_changes(tmp_path: Path):
    shutil.copytree(DEMO, tmp_path / "in")
    first = _run(tmp_path)
    assert first.status == "succeeded" and first.stats["created"] == 8
    second = _run(tmp_path)
    assert second.stats.get("unchanged_bytes") == 8 and "created" not in second.stats
    assert _count(Opportunity) == 8 and _count(OpportunityVersion) == 8 and _count(SourceSnapshot) == 8

    notice = tmp_path / "in" / "demo-001.json"
    data = json.loads(notice.read_text())
    data["deadline_at"] = "@anchor+35d"
    data["status"] = "EXTENDED"
    notice.write_text(json.dumps(data, ensure_ascii=False))
    third = _run(tmp_path)
    assert third.stats["updated"] == 1
    with system_session() as s:
        opp = s.scalar(select(Opportunity).where(Opportunity.external_ref == "DEMO-2026-001"))
        assert opp.current_version == 2 and opp.status == "EXTENDED"
        types = set(
            s.scalars(select(OpportunityEvent.event_type).where(OpportunityEvent.opportunity_id == opp.id)).all()
        )
        assert {"NEW", "DEADLINE_EXTENDED", "EXTENDED"} <= types
    assert _count(Opportunity) == 8  # never duplicated


def test_unverified_source_is_blocked(tmp_path: Path):
    shutil.copytree(DEMO, tmp_path / "in")
    run = _run(tmp_path, status="pending_verification")
    assert run.status == "blocked" and _count(Opportunity) == 0


def test_bad_record_is_isolated(tmp_path: Path):
    (tmp_path / "in").mkdir()
    shutil.copy(DEMO / "demo-001.json", tmp_path / "in" / "a.json")
    (tmp_path / "in" / "b.json").write_text("{not json")
    run = _run(tmp_path)
    assert run.status == "partial" and run.stats["failed"] == 1 and run.stats["created"] == 1
    assert "b.json" in (run.error or "")


def test_analysis_creates_cited_requirements_and_flags_injection(tmp_path: Path):
    shutil.copytree(DEMO, tmp_path / "in")
    _run(tmp_path)
    run_until_idle()
    from forsa.db.models import DocumentVersion, Evidence, Requirement

    with system_session() as s:
        opp = s.scalar(select(Opportunity).where(Opportunity.external_ref == "DEMO-2026-002"))
        reqs = s.scalars(select(Requirement).where(Requirement.opportunity_id == opp.id)).all()
        assert any(r.params.get("min_count") == 3 for r in reqs)
        for r in reqs:
            ev = s.get(Evidence, r.evidence_id)
            assert ev.quote and ev.page == 1 and ev.document_version_id is not None
        flagged = s.scalars(select(DocumentVersion).where(DocumentVersion.risk_flags != [])).all()
        assert len(flagged) == 1
        assert {c["concept_id"] for c in opp.concepts} >= {"water.drilling", "energy.solar_pumping"}
