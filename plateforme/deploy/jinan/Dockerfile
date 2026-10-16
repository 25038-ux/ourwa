# L'API et le site, construits en production, dans UNE image (deux services la
# lancent avec deux commandes). Le contexte est la racine du dépôt (le zip).
#
# L'enseigne n'est PAS inscrite ici : le site et l'API la lisent dans leur
# environnement au démarrage (docker-compose.yml → .env). La même image sert
# donc toute enseigne ; seul NEXT_PUBLIC_API_URL est fixé à la construction —
# l'adresse de l'API vue du conteneur du site, sur le réseau Docker.
FROM node:22-bookworm-slim AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1
# pnpm lui-même vient du réseau (corepack) : cinq essais, puis la preuve qu'il est là.
RUN corepack enable && \
    for essai in 1 2 3 4 5; do \
      corepack prepare pnpm@9.12.3 --activate && break; \
      echo "corepack : pnpm non téléchargé (essai $essai sur 5), nouvel essai dans 15 s"; sleep 15; \
    done && \
    pnpm --version
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY tools/package.json tools/
# ⚠ LE TÉLÉCHARGEMENT DES PAQUETS EST LE SEUL PAS QUI DÉPEND DU RÉSEAU (16/10/2026).
# Une coupure au milieu des ~500 paquets faisait échouer la construction, et la
# relance repartait de zéro. Le magasin de pnpm vit donc dans un cache de
# construction (gardé d'une construction à l'autre, hors de l'image) : une
# relance ne télécharge que ce qui manque, et une mise à jour seulement les
# paquets qui ont changé. pnpm réessaie aussi chaque paquet six fois (de 10 s à
# 2 min d'attente) avant d'abandonner. `install.sh` relance la construction
# entière jusqu'à trois fois.
ENV npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_network_concurrency=8
RUN --mount=type=cache,id=jinan-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
ENV NEXT_PUBLIC_API_URL=http://api:3001
RUN pnpm --filter @elourwa/api build && pnpm --filter @elourwa/web build

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3000 3001
# Par défaut l'API ; le service `web` remplace la commande.
CMD ["pnpm", "--filter", "@elourwa/api", "start"]
