# SETUP — Local Development

## Prereqs

- Node.js 20.11+ (use `nvm use`)
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker (for PostgreSQL) — or a local Postgres 16 with `pgcrypto` + `citext`
- `qpdf` on PATH (mandatory in Phase 1 — the API does a startup health
  check via `qpdf --version` and fails fast if the binary is missing).
    - macOS: `brew install qpdf`
    - Debian / Ubuntu: `sudo apt-get install -y qpdf`
    - Alpine: `apk add --no-cache qpdf`

## 1. Install

From the repo root (`app/`):

```bash
pnpm install
```

## 2. Start Postgres (+ optional Redis)

```bash
docker compose up -d postgres
# or, if you want Redis too:
docker compose up -d
```

`pgcrypto` and `citext` extensions are created by the initial migration, so no
manual setup is needed.

## 3. Env files

Copy and edit:

```bash
cp .env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

**Generate secrets** (Linux/macOS):

```bash
openssl rand -hex 32           # → JWT_ACCESS_SECRET
openssl rand -hex 32           # → JWT_REFRESH_SECRET
openssl rand -base64 32        # → CREDS_ENCRYPTION_KEY
```

Set `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD` for the seed script.

For the mail adapter, keep `MAIL_PROVIDER=console` in dev (logs emails to the
terminal). Set `MAIL_PROVIDER=resend` + `RESEND_API_KEY` for real sends.

For R2 you can leave the vars empty during auth smoke-testing; the storage
service will log a warning. Fill them in to test uploads/downloads.

## 4. Build the shared package

The API and web app both import from `@cs-platform/shared`. Build it once so
the `dist/` outputs exist:

```bash
pnpm --filter @cs-platform/shared build
```

During development you can run it in watch mode:

```bash
pnpm --filter @cs-platform/shared dev
```

## 5. Run migrations + seed the admin

```bash
pnpm --filter @cs-platform/api migration:run
pnpm --filter @cs-platform/api seed
```

The seed is idempotent: if `ADMIN_EMAIL` already exists, the user is promoted
to admin and marked email-verified. Otherwise a new admin row is inserted.

## 6. Start the dev servers

In two terminals (or `pnpm dev` at root to run in parallel):

```bash
pnpm --filter @cs-platform/api dev
pnpm --filter @cs-platform/web dev
```

- API: http://localhost:3001 (Swagger at `/api/docs` in dev)
- Web: http://localhost:3000

## 7. Smoke test

- Open http://localhost:3000 → click **Get started** → register a user.
- Check the API terminal for the `[mail:verify-email]` log and copy the URL
  from the `EMAIL TEXT` block.
- Visit `/verify-email?token=...` → login.
- Log in as the admin (seeded above) to reach `/admin`.

## Useful commands

```bash
pnpm dev                                       # run api + web in parallel
pnpm build                                     # build all workspaces
pnpm typecheck                                 # typecheck all workspaces
pnpm lint                                      # lint all workspaces

pnpm --filter @cs-platform/api migration:run
pnpm --filter @cs-platform/api migration:revert
pnpm --filter @cs-platform/api seed
```

## Troubleshooting

- **`type "citext" does not exist`**: the migration enables the `citext`
  extension — re-run `migration:run` against a clean DB.
- **`relation "users" does not exist`**: migrations haven't run. See above.
- **Verification link not arriving**: in dev, the console adapter prints the
  full email body with the link to the API terminal.
- **`pnpm install` fails on Apple Silicon for `argon2`**: native deps require
  Python + build toolchain. `xcode-select --install` usually fixes it.
