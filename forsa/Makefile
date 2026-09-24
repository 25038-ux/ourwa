# Developer entry points. Everything a contributor runs locally is here (and in CI).
BACKEND := backend
PY := $(BACKEND)/.venv/bin

.PHONY: setup lint typecheck test eval check demo api worker web

setup:
	cd $(BACKEND) && uv venv -q .venv && uv pip install -q -p .venv/bin/python -e ".[dev]"
	cd web && npm ci --no-audit --no-fund

lint:
	$(PY)/ruff check $(BACKEND)/src $(BACKEND)/tests $(BACKEND)/migrations
	$(PY)/ruff format --check $(BACKEND)/src $(BACKEND)/tests $(BACKEND)/migrations

typecheck:
	cd $(BACKEND) && .venv/bin/mypy
	cd web && npx tsc --noEmit

test:
	cd $(BACKEND) && .venv/bin/pytest

eval:
	$(PY)/forsa eval

check: lint typecheck test eval

demo:
	$(PY)/forsa demo

api:
	cd $(BACKEND) && .venv/bin/uvicorn forsa.api.app:app --reload --port 8000

worker:
	$(PY)/forsa worker

web:
	cd web && npm run dev
