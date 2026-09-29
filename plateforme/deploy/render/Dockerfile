# UN SEUL CONTENEUR POUR RENDER (offre gratuite : un service, un port) :
# Caddy écoute sur $PORT et route selon le nom d'hôte — les noms d'école vers
# le site (:3000), `api.` et le nom *.onrender.com vers l'API (:3001). Render
# termine le TLS ; ici c'est du HTTP interne. La base est ailleurs (Neon).
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
# Le site parle à l'API dans le même conteneur (NEXT_PUBLIC_* est inscrit à la construction).
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
RUN pnpm --filter @elourwa/api build && pnpm --filter @elourwa/web build
# Les paquets de l'espace de travail (@elourwa/shared, @elourwa/db) exportent
# leurs sources TypeScript ; en production on les COMPILE et on fait pointer
# leurs exports vers le JavaScript — l'API tourne alors avec `node` seul, sans
# `tsx` qui transpilait à la volée à chaque démarrage (mémoire et minutes de
# processeur sur la petite instance gratuite). Modification interne à l'image.
RUN for p in shared db; do (cd packages/$p && rm -rf dist && pnpm exec tsc -p tsconfig.json --outDir dist --noEmit false --declaration false --sourceMap false); done   && node -e "const fs=require('fs');for(const [p,pre] of [['shared','./dist/'],['db','./dist/src/']]){const f='packages/'+p+'/package.json';const d=JSON.parse(fs.readFileSync(f,'utf8'));const r=v=>v.replace('./src/',pre).replace(/\.ts$/,'.js');d.main=r(d.main);for(const k of Object.keys(d.exports))d.exports[k]=r(d.exports[k]);fs.writeFileSync(f,JSON.stringify(d,null,2));}"   && (cd apps/api && node -e "Promise.all([import('@elourwa/shared'),import('@elourwa/db')]).then(([s,d])=>{if(typeof s.money!=='function'||typeof d.withTenant!=='function')throw new Error('paquets compilés incomplets');console.log('shared/db compilés');})")

FROM build AS runtime
# Pas de Caddy : le binaire de caddy:2-alpine porte une capacité de fichier que
# le bac à sable de Render refuse d'exécuter (« Operation not permitted »). Le
# mandataire est deploy/render/proxy.mjs — Node, déjà là, testé en local avec
# l'API et le site construits.
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update -qq   && apt-get install -y -qq --no-install-recommends postgresql-client ca-certificates >/dev/null   && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
RUN node --check deploy/render/proxy.mjs
COPY deploy/render/entrypoint.sh /entrypoint.sh
# Une faute dans le script casse la CONSTRUCTION (visible), jamais le déploiement.
RUN chmod +x /entrypoint.sh && bash -n /entrypoint.sh && node --check deploy/render/proxy.mjs   && test -f apps/api/dist/main.js && test -f apps/web/.next/BUILD_ID
EXPOSE 10000
CMD ["/entrypoint.sh"]
