#!/usr/bin/env bash
# One-command deployment of FORSA on a fresh Linux server with Docker.
#   ./deploy.sh                 build + start (first run: generates secrets into .env)
#   ./deploy.sh admin EMAIL ORG-SLUG "Organisation name"
#                               create the first owner + platform admin (prompts for a password)
set -euo pipefail
cd "$(dirname "$0")"
compose() { docker compose -f docker-compose.prod.yml "$@"; }

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/"; exit 1; }

if [[ "${1:-}" == "admin" ]]; then
  [[ -n "${2:-}" && -n "${3:-}" ]] || { echo 'usage: ./deploy.sh admin you@example.mr my-company "My Company SARL"'; exit 1; }
  compose run --rm api forsa create-user --email "$2" --org "$3" --org-name "${4:-$3}" --platform-admin
  exit 0
fi

if [[ ! -f .env ]]; then
  cp .env.prod.example .env
  gen() { python3 -c "import secrets; print(secrets.token_urlsafe($1))"; }
  sed -i "s|^FORSA_JWT_SECRET=.*|FORSA_JWT_SECRET=$(gen 48)|" .env
  sed -i "s|^POSTGRES_ADMIN_PASSWORD=.*|POSTGRES_ADMIN_PASSWORD=$(gen 24)|" .env
  sed -i "s|^FORSA_DB_PASSWORD=.*|FORSA_DB_PASSWORD=$(gen 24)|" .env
  echo "Created .env with generated secrets. Set FORSA_DOMAIN and ACME_EMAIL, then run ./deploy.sh again."
  exit 0
fi

set -a; source .env; set +a
[[ "$FORSA_DOMAIN" != "forsa.example.mr" && -n "$FORSA_DOMAIN" ]] || { echo "Set FORSA_DOMAIN in .env"; exit 1; }

mkdir -p backups
compose build
if [[ -z "${FORSA_VAPID_PRIVATE_KEY:-}" ]]; then
  echo "Generating Web Push (VAPID) keys…"
  keys=$(compose run --rm --no-deps -T api forsa vapid-keys)
  pub=$(echo "$keys" | sed -n 's/.*FORSA_VAPID_PUBLIC_KEY=\(.*\)/\1/p' | tr -d '\r')
  priv=$(echo "$keys" | sed -n 's/.*FORSA_VAPID_PRIVATE_KEY=\(.*\)/\1/p' | tr -d '\r')
  sed -i "s|^FORSA_VAPID_PUBLIC_KEY=.*|FORSA_VAPID_PUBLIC_KEY=$pub|; s|^FORSA_VAPID_PRIVATE_KEY=.*|FORSA_VAPID_PRIVATE_KEY=$priv|" .env
fi
compose up -d
echo
echo "FORSA is starting on https://$FORSA_DOMAIN (certificate issuance can take a minute)."
echo 'Create the first admin:  ./deploy.sh admin you@example.mr my-company "My Company SARL"'
echo "Logs:                    docker compose -f docker-compose.prod.yml logs -f api worker"
