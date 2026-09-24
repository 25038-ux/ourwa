# ADR-016: Android app (Trusted Web Activity) and single-server production deployment

**Status:** Accepted (2026-09-24)

## Android
A native Android shell (`android/`, Kotlin, minSdk 24, targetSdk 35) that opens FORSA as a **Trusted Web Activity**
(Chrome renders the PWA full-screen: Web Push, voice dictation, uploads, same code as the web). When no TWA-capable
browser exists it falls back to its own **WebView shell** (microphone, file uploads, .ics downloads, pull-to-refresh,
offline screen). The server address is asked on first launch (or baked in with `-PforsaUrl`), so one APK serves any
deployment. Full-screen requires Digital Asset Links: the API serves `/.well-known/assetlinks.json` from
`FORSA_ANDROID_SHA256`. Rejected: a React Native / Capacitor rewrite (a second UI codebase to keep in sync).

## Deployment
`infra/deployment/`: Docker Compose on one server — Postgres (app role **NOSUPERUSER NOBYPASSRLS**, created by an init
script), migrate, API, worker, web, **Caddy** (automatic HTTPS, HSTS, no compression on live streams), nightly
`pg_dump` backups. `deploy.sh` generates secrets and VAPID keys. The API and worker **refuse to start in prod** if
the database role could bypass row-level security. Verified locally with the real images: migrations as the app
role, 25 RLS policies, HTTPS login with Secure/HttpOnly cookie, SSE through Caddy, OCR binaries present, backup file.

Bugs found and fixed while doing this: the web image baked `localhost:8000` as API address (Next.js rewrites are
build-time); the dev compose connected as a Postgres superuser (RLS bypass); no `.dockerignore` (host
`node_modules` copied into images).
