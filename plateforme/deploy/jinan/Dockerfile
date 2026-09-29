# L'API et le site, construits en production, dans UNE image (deux services la
# lancent avec deux commandes). Le contexte est la racine du dépôt (le zip).
#
# L'enseigne n'est PAS inscrite ici : le site et l'API la lisent dans leur
# environnement au démarrage (docker-compose.yml → .env). La même image sert
# donc toute enseigne ; seul NEXT_PUBLIC_API_URL est fixé à la construction —
# l'adresse de l'API vue du conteneur du site, sur le réseau Docker.
FROM node:22-bookworm-slim AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY tools/package.json tools/
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_PUBLIC_API_URL=http://api:3001
RUN pnpm --filter @elourwa/api build && pnpm --filter @elourwa/web build

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3000 3001
# Par défaut l'API ; le service `web` remplace la commande.
CMD ["pnpm", "--filter", "@elourwa/api", "start"]
