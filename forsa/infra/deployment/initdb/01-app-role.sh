#!/bin/bash
# Runs once, on first start of an empty database volume.
# The application MUST NOT connect as a superuser: superusers bypass row-level security (tenant isolation).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE forsa LOGIN PASSWORD '${FORSA_DB_PASSWORD}' NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE DATABASE forsa OWNER forsa;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname forsa <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
SQL
