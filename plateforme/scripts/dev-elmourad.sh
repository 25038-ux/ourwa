#!/usr/bin/env bash
# L'API et le site EN ÉCOLE UNIQUE, sous l'enseigne El Mourad, à côté de la
# pile El Ourwa (ports 3001/3000) : l'API sur :3011, le site sur :3010, la même
# base de développement (l'école « elmourad » y est installée par
# `pnpm --filter @elourwa/db bootstrap-school -- --slug elmourad …`).
#
#   scripts/dev-elmourad.sh api     # http://localhost:3011/health → mode « ecole-unique »
#   scripts/dev-elmourad.sh web     # http://localhost:3010 → El Mourad, sans console
#
# Sert à vérifier au navigateur ce qu'El Mourad verra : chaque libellé, l'absence
# de console, une école VIDE (aucune année, aucun niveau) qui n'écrase aucune page.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.npm-global:$PATH"
set -a; . deploy/brands/elmourad.env; set +a
export NEXT_PUBLIC_API_URL="http://localhost:3011"
export NEXT_DIST_DIR=".next-elmourad"
case "${1:-}" in
  api) API_PORT=3011 exec npx --yes pnpm@9.12.3 --filter @elourwa/api dev ;;
  web) exec npx --yes pnpm@9.12.3 --filter @elourwa/web exec next dev -p 3010 -H 0.0.0.0 ;;
  *) echo "usage: $0 api|web" >&2; exit 2 ;;
esac
