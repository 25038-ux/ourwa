"""FORSA command line: `forsa --help`."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import select

from forsa.settings import get_settings


def _alembic_upgrade(url: str | None = None) -> None:
    from alembic import command
    from alembic.config import Config

    backend = Path(os.environ.get("FORSA_BACKEND_DIR") or Path(__file__).resolve().parents[2])
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "migrations"))
    if url:
        cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")


def cmd_db_upgrade(_: argparse.Namespace) -> None:
    _alembic_upgrade()
    print("database at head")


def cmd_sources_sync(_: argparse.Namespace) -> None:
    from forsa.db.session import system_session
    from forsa.ingestion.registry import sync_registry
    from forsa.runtime import get_runtime

    with system_session() as s:
        rows = sync_registry(s, get_runtime().registry)
        for r in rows:
            print(f"{r.key:32} {r.status:22} {r.connector}")


def cmd_reparse(args: argparse.Namespace) -> None:
    """Re-apply the current connector parser to stored snapshots (after a parser fix); then run follow-up jobs."""
    from sqlalchemy import select as _select

    from forsa.db.models import Source
    from forsa.db.session import system_session
    from forsa.ingestion.connectors.factory import build_connector
    from forsa.ingestion.pipeline import IngestionPipeline
    from forsa.jobs.worker import run_until_idle
    from forsa.runtime import get_runtime

    rt = get_runtime()
    rec = rt.registry[args.source]
    with system_session() as s:
        source = s.scalar(_select(Source).where(Source.key == rec.id))
        if source is None:
            raise SystemExit(f"source {rec.id} has never been ingested")
        stats = IngestionPipeline(s, rt.store).reparse(
            source, build_connector(rec), synthetic=rec.access_type == "synthetic_fixture"
        )
    print(json.dumps(stats, indent=2))
    print(f"processed {run_until_idle()} follow-up job(s)")


def cmd_ingest(args: argparse.Namespace) -> None:
    from forsa.db.session import system_session
    from forsa.jobs.handlers import ingest_source
    from forsa.jobs.worker import run_until_idle

    with system_session() as s:
        print(json.dumps(ingest_source(s, {"source_key": args.source}), default=str, indent=2))
    if not args.no_process:
        print(f"processed {run_until_idle()} follow-up job(s)")


def cmd_worker(args: argparse.Namespace) -> None:
    from forsa.jobs.worker import run_forever, run_until_idle
    from forsa.logging_setup import configure_logging

    configure_logging()
    if args.once:
        print(f"processed {run_until_idle()} job(s)")
    else:
        run_forever()


def _resolve(value: str | None, anchor: date) -> date | None:
    from forsa.ingestion.connectors.fixture import resolve_date

    dt = resolve_date(value, anchor)
    return dt.date() if dt else None


def seed_demo_companies(path: Path, password: str) -> list[str]:
    from forsa.db.models import CompanyProject, Membership, Organization, User
    from forsa.db.session import system_session, tenant_session
    from forsa.identity.rbac import Role, TenantContext
    from forsa.identity.security import hash_password
    from forsa.kernel.clock import utcnow
    from forsa.runtime import get_runtime
    from forsa.services import companies as svc

    rt = get_runtime()
    anchor = rt.settings.demo_anchor
    logins = []
    for spec in json.loads(path.read_text(encoding="utf-8")):
        with system_session() as s:
            org = s.scalar(select(Organization).where(Organization.slug == spec["org"]["slug"]))
            if org is None:
                org = Organization(**spec["org"])
                s.add(org)
                s.flush()
            owner_id = None
            for u in spec["users"]:
                user = s.scalar(select(User).where(User.email == u["email"]))
                if user is None:
                    user = User(email=u["email"], full_name=u["full_name"], password_hash=hash_password(password))
                    s.add(user)
                    s.flush()
                if not s.scalar(select(Membership).where(Membership.org_id == org.id, Membership.user_id == user.id)):
                    s.add(Membership(org_id=org.id, user_id=user.id, role=u["role"]))
                if u["role"] == "OWNER":
                    owner_id = user.id
                logins.append(u["email"])
            org_id = org.id
        assert owner_id is not None
        ctx = TenantContext(org_id=org_id, user_id=owner_id, role=Role.OWNER, request_id="seed")
        with tenant_session(org_id) as s:
            company = svc.update_twin(s, ctx, spec["company"])
            company.onboarding_completed_at = company.onboarding_completed_at or utcnow()
            key, digest = rt.store.put(
                f"Justificatifs de démonstration — {spec['org']['name']}".encode(), f"documents/org/{org_id}"
            )
            _, evidence = svc.register_company_document(
                s,
                ctx,
                "Justificatifs (démo, synthétique)",
                key,
                digest,
                "text",
                64,
                [(1, "Document synthétique de démonstration.")],
                False,
                [],
            )
            for cap in spec.get("capabilities", []):
                row = svc.set_capability(s, ctx, cap["concept_id"])
                if cap.get("verified"):
                    svc.verify_claim(s, ctx, "capability", row.id, [evidence.id])
            for cred in spec.get("credentials", []):
                cred_row = svc.set_credential(
                    s, ctx, cred["credential_id"], cred["status"], _resolve(cred.get("valid_until"), anchor)
                )
                if cred.get("verified"):
                    svc.verify_claim(s, ctx, "credential", cred_row.id, [evidence.id])
            existing = {p.title for p in s.scalars(select(CompanyProject).where(CompanyProject.org_id == org_id))}
            for proj in spec.get("projects", []):
                if proj["title"] in existing:
                    continue
                proj_row = svc.add_project(s, ctx, {k: v for k, v in proj.items() if k != "verified"})
                if proj.get("verified"):
                    svc.verify_claim(s, ctx, "project", proj_row.id, [evidence.id])
    return logins


def cmd_demo(args: argparse.Namespace) -> None:
    settings = get_settings()
    if settings.env == "prod":
        sys.exit("refusing to seed demo data in prod")
    from forsa.db.models import User
    from forsa.db.session import system_session
    from forsa.identity.security import hash_password
    from forsa.ingestion.registry import sync_registry
    from forsa.jobs.handlers import ingest_source
    from forsa.jobs.worker import run_until_idle
    from forsa.runtime import get_runtime

    _alembic_upgrade()
    password = os.environ.get("FORSA_DEMO_PASSWORD", "forsa-demo-2026")
    with system_session() as s:
        sync_registry(s, get_runtime().registry)
        if not s.scalar(select(User).where(User.email == "admin@forsa.demo")):
            s.add(
                User(
                    email="admin@forsa.demo",
                    full_name="Platform admin (demo)",
                    is_platform_admin=True,
                    password_hash=hash_password(password),
                )
            )
    logins = seed_demo_companies(settings.fixtures_dir / "demo" / "companies.json", password)
    with system_session() as s:
        result = ingest_source(s, {"source_key": "forsa-demo"})
    jobs = run_until_idle()
    print(json.dumps({"ingestion": result, "jobs_processed": jobs}, default=str, indent=2))
    print(
        "\nDemo logins (password: %s):" % ("$FORSA_DEMO_PASSWORD" if "FORSA_DEMO_PASSWORD" in os.environ else password)
    )
    for email in ["admin@forsa.demo", *logins]:
        print("  ", email)
    print(
        "\nAll demo notices are SYNTHETIC (source 'forsa-demo'); dates are relative to FORSA_DEMO_ANCHOR "
        f"= {settings.demo_anchor}."
    )


def cmd_create_user(args: argparse.Namespace) -> None:
    from forsa.db.models import Membership, Organization, User
    from forsa.db.session import system_session
    from forsa.identity.rbac import Role
    from forsa.identity.security import hash_password

    password = os.environ.get("FORSA_NEW_USER_PASSWORD") or getpass.getpass("Password: ")
    Role(args.role)
    with system_session() as s:
        org = s.scalar(select(Organization).where(Organization.slug == args.org))
        if org is None:
            org = Organization(name=args.org_name or args.org, slug=args.org, country=args.country)
            s.add(org)
            s.flush()
        user = User(
            email=args.email.lower(),
            full_name=args.name or args.email,
            password_hash=hash_password(password),
            is_platform_admin=args.platform_admin,
        )
        s.add(user)
        s.flush()
        s.add(Membership(org_id=org.id, user_id=user.id, role=args.role))
    print(f"created {args.email} in {args.org} as {args.role}")


def cmd_rematch(_: argparse.Namespace) -> None:
    """Recompute every company's matches (run after a scoring-model version change)."""
    from forsa.db.models import Company
    from forsa.db.session import system_session
    from forsa.jobs.queue import enqueue
    from forsa.jobs.worker import run_until_idle
    from forsa.kernel.clock import utcnow

    with system_session() as s:
        for company in s.scalars(select(Company)).all():
            enqueue(
                s,
                "match_company",
                {"company_id": str(company.id)},
                org_id=company.org_id,
                key=f"rematch:{company.id}:{utcnow().isoformat()}",
            )
    print(f"processed {run_until_idle()} job(s)")


def cmd_vapid_keys(_: argparse.Namespace) -> None:
    """Print a Web Push VAPID key pair to put in FORSA_VAPID_PUBLIC_KEY / FORSA_VAPID_PRIVATE_KEY."""
    from forsa.services.notifications import generate_vapid_keys

    keys = generate_vapid_keys()
    print(f"FORSA_VAPID_PUBLIC_KEY={keys['public_key']}\nFORSA_VAPID_PRIVATE_KEY={keys['private_key']}")


def cmd_eval(args: argparse.Namespace) -> None:
    from forsa.evals import run_all

    report = run_all(Path(args.dir) if args.dir else None)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if report["failed"]:
        sys.exit(1)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="forsa", description="FORSA commercial intelligence platform")
    sub = p.add_subparsers(required=True)
    sub.add_parser("db-upgrade", help="apply database migrations").set_defaults(fn=cmd_db_upgrade)
    sub.add_parser("sources-sync", help="sync sources/registry.yaml into the database").set_defaults(
        fn=cmd_sources_sync
    )
    ing = sub.add_parser("ingest", help="run one source ingestion now")
    ing.add_argument("source")
    ing.add_argument("--no-process", action="store_true", help="do not run follow-up jobs inline")
    ing.set_defaults(fn=cmd_ingest)
    rp = sub.add_parser("reparse", help="re-apply the current parser to stored snapshots (no network)")
    rp.add_argument("source")
    rp.set_defaults(fn=cmd_reparse)
    w = sub.add_parser("worker", help="run the background worker")
    w.add_argument("--once", action="store_true", help="drain the queue and exit")
    w.set_defaults(fn=cmd_worker)
    sub.add_parser("demo", help="migrate + seed synthetic demo data (dev only)").set_defaults(fn=cmd_demo)
    cu = sub.add_parser("create-user", help="create a user (password from FORSA_NEW_USER_PASSWORD or prompt)")
    cu.add_argument("--email", required=True)
    cu.add_argument("--org", required=True, help="organisation slug (created if missing)")
    cu.add_argument("--org-name")
    cu.add_argument("--country", default="MR")
    cu.add_argument("--name")
    cu.add_argument("--role", default="OWNER")
    cu.add_argument("--platform-admin", action="store_true")
    cu.set_defaults(fn=cmd_create_user)
    sub.add_parser("rematch", help="recompute all matches (after a scoring change)").set_defaults(fn=cmd_rematch)
    sub.add_parser("vapid-keys", help="generate Web Push VAPID keys (needs forsa[push])").set_defaults(
        fn=cmd_vapid_keys
    )
    ev = sub.add_parser("eval", help="run AI/matching evaluation suites")
    ev.add_argument("--dir")
    ev.set_defaults(fn=cmd_eval)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
