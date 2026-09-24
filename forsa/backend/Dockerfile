# FORSA backend image — API (uvicorn) and worker share one image; the command selects the role.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# OCR for scanned notices (French + Arabic) and PDF rasterisation.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-fra tesseract-ocr-ara poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN useradd --create-home --uid 10001 forsa
COPY backend/pyproject.toml backend/alembic.ini ./backend/
COPY backend/src ./backend/src
COPY backend/migrations ./backend/migrations
# ai: Anthropic SDK (optional provider) · push: Web Push delivery
RUN pip install "./backend[ai,push]"
COPY sources ./sources
COPY fixtures ./fixtures
COPY evals ./evals
ENV FORSA_SOURCE_REGISTRY=/app/sources/registry.yaml FORSA_FIXTURES_DIR=/app/fixtures FORSA_STORAGE_DIR=/data/storage \
    FORSA_BACKEND_DIR=/app/backend FORSA_EVALS_DIR=/app/evals OMP_THREAD_LIMIT=1
RUN mkdir -p /data/storage && chown -R forsa /data
USER forsa
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status == 200 else 1)" || exit 1
CMD ["uvicorn", "forsa.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
