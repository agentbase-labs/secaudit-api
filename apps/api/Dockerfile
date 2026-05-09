# syntax=docker/dockerfile:1.7

# ---- base ----
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# qpdf is required for server-side PDF password encryption
RUN apt-get update && apt-get install -y --no-install-recommends qpdf tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @cs-platform/shared build \
 && pnpm --filter @cs-platform/api build

# ---- runner ----
FROM node:20-bookworm-slim AS runner
# Auto-recon Phase 1: install qpdf (PDF), tini (init), nikto (web scanner),
# unzip (for nuclei archive), curl + ca-certificates (for downloads).
RUN apt-get update && apt-get install -y --no-install-recommends \
      qpdf tini nikto unzip curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install nuclei (pinned 3.2.9 — last-good-known stable; do NOT use 'latest').
RUN curl -sSL "https://github.com/projectdiscovery/nuclei/releases/download/v3.2.9/nuclei_3.2.9_linux_amd64.zip" -o /tmp/nuclei.zip \
  && unzip -o /tmp/nuclei.zip -d /usr/local/bin/ \
  && chmod +x /usr/local/bin/nuclei \
  && rm /tmp/nuclei.zip \
  && nuclei -version \
  && (nuclei -update-templates -ud /opt/nuclei-templates 2>/dev/null || echo 'template fetch failed (non-fatal — runtime will retry on first scan)')

ENV NUCLEI_TEMPLATES_DIR=/opt/nuclei-templates
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/package.json ./package.json
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node", "apps/api/dist/main.js"]
