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
RUN apt-get update && apt-get install -y --no-install-recommends qpdf tini \
  && rm -rf /var/lib/apt/lists/*
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
