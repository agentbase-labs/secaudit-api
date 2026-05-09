# syntax=docker/dockerfile:1.7
#
# Backend (NestJS API) Dockerfile — built at MONOREPO ROOT context.
#
# Used by AgentBase / Render to deploy the API as a Docker service.
# The `qpdf` system binary is required at runtime by `QpdfService`
# (PDF password encryption); we install it in both the builder and
# runtime stages.
#
# Build locally (sanity check):
#   docker build -f Dockerfile -t cs-platform-api .
#

# ---------- base ----------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# qpdf required for server-side PDF password encryption (QpdfService).
# tini gives us a proper PID 1 / signal handling.
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- deps ----------
# Install workspace deps with --frozen-lockfile against the committed lock.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- build ----------
# Copy the rest of the source and build the shared lib + the API.
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @cs-platform/shared build \
 && pnpm --filter @cs-platform/api build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends qpdf tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=10000
WORKDIR /app

# Bring node_modules (workspace-hoisted) and built artefacts only.
# Copy the whole /app tree from the build stage to preserve pnpm's
# symlink layout (apps/api/node_modules → ../../node_modules/.pnpm/...).
COPY --from=build /app /app
# Strip the source we don't need at runtime to slim the image.
RUN rm -rf /app/apps/api/src /app/apps/api/test /app/apps/api/tsconfig*.json \
           /app/apps/web /app/tsconfig.base.json

# Run as the unprivileged `node` user that ships with the base image.
USER node

EXPOSE 10000
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node", "apps/api/dist/main.js"]
