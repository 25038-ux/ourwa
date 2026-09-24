"""FastAPI application factory (versioned API under /api/v1, OpenAPI at /api/v1/openapi.json)."""

from __future__ import annotations

import json
import logging
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from forsa import __version__
from forsa.api.deps import COOKIE
from forsa.api.routers import (
    admin_ai,
    assistant,
    auth,
    bids,
    calendar,
    company,
    live,
    market,
    matches,
    opportunities,
    platform,
    workspace,
)
from forsa.db.session import check_role_safety, get_engine
from forsa.kernel.errors import ForsaError
from forsa.logging_setup import configure_logging
from forsa.settings import get_settings

log = logging.getLogger("forsa.api")
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.validate_for_prod()
    check_role_safety(settings.env)  # refuses to start in prod if the DB role bypasses row-level security
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging()
    app = FastAPI(
        lifespan=_lifespan,
        title="FORSA API",
        version=__version__,
        openapi_url="/api/v1/openapi.json",
        docs_url="/api/v1/docs" if settings.env != "prod" else None,
        redoc_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-Org-Id", "X-Requested-With"],
    )

    @app.middleware("http")
    async def envelope(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or secrets.token_hex(8)
        request.state.request_id = request_id
        # CSRF: cookie-authenticated state changes must carry a custom header (cannot be sent cross-site
        # without a CORS preflight, which only the web origin passes).
        if (
            request.method in UNSAFE
            and request.url.path.startswith("/api/")
            and not request.headers.get("authorization")
            and request.headers.get("x-requested-with") != "forsa"
        ):
            return JSONResponse(
                {"error": {"code": "csrf", "message": "missing X-Requested-With header"}}, status_code=403
            )
        started = time.monotonic()
        response = await call_next(request)
        elapsed = (time.monotonic() - started) * 1000
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/v1/docs"):
            # no-transform: intermediaries (incl. the Next.js rewrite's gzip) must not buffer SSE streams.
            response.headers["Cache-Control"] = "no-store, no-transform"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        log.info(
            json.dumps(
                {
                    "event": "http",
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round(elapsed, 1),
                    "request_id": request_id,
                }
            )
        )
        return response

    @app.exception_handler(ForsaError)
    async def forsa_error(request: Request, exc: ForsaError) -> JSONResponse:
        resp = JSONResponse({"error": {"code": exc.code, "message": str(exc)}}, status_code=exc.status)
        if exc.status == 401:
            resp.delete_cookie(COOKIE, path="/")
        return resp

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict:
        return {"ok": True, "version": __version__}

    @app.get("/readyz", include_in_schema=False)
    def readyz() -> dict:
        with get_engine().connect() as conn:
            conn.execute(text("select 1"))
        return {"ok": True}

    modules = (
        auth,
        opportunities,
        company,
        matches,
        bids,
        platform,
        assistant,
        live,
        workspace,
        admin_ai,
        market,
        calendar,
    )
    for module in modules:
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
