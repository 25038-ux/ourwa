FROM node:22-slim AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js bakes rewrite destinations into the build: the API address must be known here, not only at runtime.
ARG FORSA_API_URL=http://api:8000
ENV FORSA_API_URL=${FORSA_API_URL}
RUN npm run build

FROM node:22-slim
WORKDIR /web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web ./
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
