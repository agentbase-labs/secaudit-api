# Cybersecurity Testing Platform

Monorepo scaffold for the Automated Cybersecurity Testing Platform (Phase 1 MVP).

## Structure

```
app/
├── apps/
│   ├── api/     # NestJS 10 + TypeORM + PostgreSQL
│   └── web/     # Next.js 15 (App Router) + Tailwind + shadcn/ui
└── packages/
    └── shared/  # Shared TS types, enums, zod schemas
```

## Quick Start

See [`SETUP.md`](./SETUP.md) for full setup instructions.

```bash
pnpm install
cp .env.example apps/api/.env
# (edit apps/api/.env)
pnpm --filter @cs-platform/shared build
pnpm --filter @cs-platform/api migration:run
pnpm --filter @cs-platform/api seed
pnpm dev
```

## Design Docs

See [`../design/`](../design/) for the full architecture and API spec.

## Status

See [`PROGRESS.md`](./PROGRESS.md) for what's wired up vs scaffolded.
