"""Platform admin: AI providers (catalog, keys present?, models, data ceilings). Keys never leave the env."""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from forsa.ai.catalog import catalog
from forsa.ai.providers.jev import Noul
from forsa.ai.types import AICall, AITask, Sensitivity, Tier
from forsa.api.deps import platform_admin, runtime
from forsa.db.models import AIProviderSetting, User
from forsa.db.session import system_session
from forsa.kernel.errors import NotFound
from forsa.runtime import Runtime

router = APIRouter(prefix="/admin/ai", tags=["admin"])


def _view(rt: Runtime) -> list[dict]:
    with system_session() as s:
        cfgs = {c.id: c for c in rt.gateway.configs(s)}
        settings = {x.provider_id: x for x in s.query(AIProviderSetting).all()}
    out = []
    for e in catalog().values():
        c, st = cfgs[e.id], settings.get(e.id)
        out.append(
            {
                "id": e.id,
                "name": e.name,
                "kind": e.kind,
                "region": e.region,
                "free_tier": e.free_tier,
                "docs_url": e.docs_url,
                "verified_defaults": e.verified,
                "base_url": c.base_url,
                "api_key_env": e.api_key_env,
                "key_present": c.api_key is not None,
                "needs_key": e.needs_key,
                "enabled": c.enabled,
                "requested": bool(st and st.enabled),
                "priority": c.priority,
                "models": c.models,
                "max_sensitivity": c.max_sensitivity.value,
                "dpa_reviewed": bool(st and st.dpa_reviewed),
                "notes": st.notes if st else None,
            }
        )
    return out


@router.get("/providers")
def providers(_: User = Depends(platform_admin), rt: Runtime = Depends(runtime)) -> dict:
    return {"items": _view(rt), "sensitivity_levels": [s.value for s in Sensitivity]}


class ProviderIn(BaseModel):
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=1000)
    fast_model: str | None = Field(default=None, max_length=120)
    reasoning_model: str | None = Field(default=None, max_length=120)
    decision_model: str | None = Field(default=None, max_length=120)
    max_sensitivity: Literal["public", "internal", "confidential"] | None = None
    dpa_reviewed: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)


@router.put("/providers/{provider_id}")
def update_provider(
    provider_id: str, body: ProviderIn, user: User = Depends(platform_admin), rt: Runtime = Depends(runtime)
) -> dict:
    if provider_id not in catalog():
        raise NotFound("unknown provider")
    with system_session() as s:
        row = s.get(AIProviderSetting, provider_id) or AIProviderSetting(provider_id=provider_id)
        s.add(row)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(row, k, v)
        row.updated_by = user.id
        from forsa.services.events import audit

        audit(
            s,
            "admin.ai_provider_updated",
            actor=user.id,
            subject_type="ai_provider",
            subject_id=provider_id,
            data=body.model_dump(exclude_unset=True),
        )
    return {"item": next(p for p in _view(rt) if p["id"] == provider_id)}


@router.post("/providers/{provider_id}/discover")
def discover(provider_id: str, _: User = Depends(platform_admin), rt: Runtime = Depends(runtime)) -> dict:
    with system_session() as s:
        cfg = next((c for c in rt.gateway.configs(s) if c.id == provider_id), None)
    if cfg is None:
        raise NotFound("unknown provider")
    if cfg.api_key is None and catalog()[provider_id].needs_key:
        return {"ok": False, "error": f"set {catalog()[provider_id].api_key_env} in the environment first"}
    try:
        return {"ok": True, "models": rt.gateway.list_models(cfg)[:500]}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:300]}"}


@router.post("/providers/{provider_id}/test")
def test_provider(provider_id: str, _: User = Depends(platform_admin), rt: Runtime = Depends(runtime)) -> dict:
    with system_session() as s:
        cfg = next((c for c in rt.gateway.configs(s) if c.id == provider_id), None)
        if cfg is None:
            raise NotFound("unknown provider")
        started = time.monotonic()
        try:
            if cfg.kind == "typesafe_system_one":
                d = rt.gateway.adapters[cfg.kind].decide(
                    cfg,
                    "Ping from FORSA.",
                    {"ok": Noul("Is this a ping?")},
                    cfg.model_for(Tier.DECISION) or "jev-latest",
                )
                ok, detail = d.ok, (d.error or f"p={d.probability('ok')}")
            else:
                model = cfg.model_for(Tier.FAST)
                if not model:
                    return {"ok": False, "error": "pin a fast model first (use Discover models)"}
                r = rt.gateway.adapters[cfg.kind].complete(
                    cfg,
                    AICall(
                        task=AITask.CLASSIFY,
                        system="Reply with the single word: pong",
                        prompt_version="ping",
                        user="ping",
                        max_tokens=16,
                    ),
                    model,
                )
                ok, detail = r.ok, (r.error or r.text[:60])
        except Exception as exc:
            ok, detail = False, f"{type(exc).__name__}: {str(exc)[:300]}"
    return {"ok": ok, "detail": detail, "latency_ms": int((time.monotonic() - started) * 1000)}
