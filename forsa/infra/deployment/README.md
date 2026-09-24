# Deploying FORSA (production)

One Linux server (4 vCPU / 8 GB RAM / 80 GB disk is comfortable), Docker installed, a domain name.

## 1. Before you start
* Point a DNS record (A/AAAA) for your domain, e.g. `forsa.example.mr`, to the server's public IP.
* Open ports **80** and **443** (HTTPS certificates are obtained automatically from Let's Encrypt).
* Install Docker: https://docs.docker.com/engine/install/

## 2. Install
```bash
git clone <this repository> && cd ourwa/forsa/infra/deployment
./deploy.sh            # first run: creates .env with generated secrets
nano .env              # set FORSA_DOMAIN and ACME_EMAIL (and optional keys, see below)
./deploy.sh            # builds the images, generates Web Push keys, starts everything
./deploy.sh admin you@example.mr my-company "My Company SARL"   # first owner + platform admin
```
Open `https://<your domain>` and sign in. Invite colleagues from **Équipe / Team**.

## 3. What runs
| Service | Role |
|---|---|
| `caddy` | HTTPS (automatic certificates), HSTS, compression (never on live streams) |
| `web` | Next.js app (PWA) |
| `api` | FastAPI `/api/v1` |
| `worker` | Ingestion (ARMP, World Bank, UNGM), OCR, analysis, matching, reminders, briefings |
| `db` | PostgreSQL 16 — the app connects as role `forsa` (not a superuser: row-level security applies) |
| `backup` | Nightly `pg_dump` into `./backups/` (kept `BACKUP_KEEP_DAYS` days) |

Copy `./backups/` off the server regularly (e.g. `rclone` or `scp` in a cron job). Restore: `./restore.sh backups/<file>.dump`.

## 4. Optional configuration (.env)
* **AI**: `FORSA_AI_PROVIDERS=jev,deepseek` + the matching keys (`TYPESAFE_API_KEY`, `DEEPSEEK_API_KEY`, …) and
  `FORSA_FEATURES=ai_explanations,ai_triage`. Then *Settings → AI providers → Discover* to pin model versions.
* **UNGM**: `UNGM_CLIENT_ID`, `UNGM_CLIENT_SECRET`, `UNGM_REFRESH_TOKEN` (request an API client from the UNGM
  Secretariat, eprocurement@ungm.org). Until then the UNGM source shows *AUTH_REQUIRED*.
* **Android app full-screen**: `FORSA_ANDROID_SHA256=<fingerprint>` (see `android/README.md`), then
  `docker compose -f docker-compose.prod.yml up -d api`.

## 5. Operate
```bash
docker compose -f docker-compose.prod.yml logs -f api worker     # logs
docker compose -f docker-compose.prod.yml ps                     # health
git pull && ./deploy.sh                                          # update (migrations run automatically)
docker compose -f docker-compose.prod.yml run --rm api forsa reparse mr-armp-portal   # after a parser fix
```
Source health is visible to users on the **Sources** page; stale data is flagged, never hidden.

## 6. Security checklist
- [x] App DB role is NOSUPERUSER/NOBYPASSRLS — the API refuses to start in prod otherwise.
- [x] Secrets only in `.env` (mode 600 recommended: `chmod 600 .env`); never commit it.
- [x] HTTPS + HSTS, Secure/HttpOnly/SameSite session cookie, CSRF header on writes.
- [ ] Off-site backups (your cron) · [ ] server firewall (only 22/80/443) · [ ] OS auto-updates.
