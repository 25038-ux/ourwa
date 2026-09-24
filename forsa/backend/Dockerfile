# FORSA backend image — API (uvicorn) and worker share one image; the command selects the role.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --create-home --uid 10001 forsa
COPY backend/pyproject.toml backend/alembic.ini ./backend/
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
RUN pip install ./backend
COPY sources ./sources
COPY fixtures ./fixtures
COPY evals ./evals
ENV FORSA_SOURCE_REGISTRY=/app/sources/registry.yaml FORSA_FIXTURES_DIR=/app/fixtures FORSA_STORAGE_DIR=/data/storage \
    FORSA_BACKEND_DIR=/app/backend FORSA_EVALS_DIR=/app/evals
RUN mkdir -p /data/storage && chown -R forsa /data
USER forsa
EXPOSE 8000
CMD ["uvicorn", "forsa.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
