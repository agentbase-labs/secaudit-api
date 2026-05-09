# PROGRESS — What's Working, What's Scaffolded, What's Deferred

## 🟨 Deploy In Progress — 2026-05-09 (resume agent #2)

AgentBase workflow `af0c16d3-96b0-4153-91dd-35e1e5bd1b72` initialized for `secaudit.xyz`. Domain registered ($3, expires 2027-05-09), frontend repo `agentbase-labs/secaudit-xyz` created. Wallet balance: $388.00 (no spend during this session beyond the original $3 domain).

**Still blocked at `commit_code` step**: GitHub secondary rate limit persists. Resume agent #2 (2026-05-09 ~13:00 UTC, ~75 min after the original 429s) made **4 fresh attempts at 5-min intervals (12:55, 13:01, 13:06, 13:11 UTC)** — every one returned the same `secondary rate limit` 400 from GitHub. The limit is on the **agentbase-labs GitHub org**, not on us, and AgentBase's commit endpoint has no built-in backoff or alternative path. Per the resume runbook (3+ failures → STOP and report), the agent stopped without burning more cycles.

**Code fixes that DID land during this session (already in workspace, will be picked up on next commit attempt):**

1. **Critical Dockerfile path mismatch fixed.** `apps/api/tsconfig.json` had a `paths` mapping `@cs-platform/shared` → `../../packages/shared/src` which caused `nest build` to compute a rootDir spanning both apps/api and packages/shared, emitting build output at `dist/apps/api/src/main.js` instead of `dist/main.js`. The Dockerfile's runtime CMD is `node apps/api/dist/main.js` — **the previous deploy-prep would have crashed on startup with MODULE_NOT_FOUND**. Removed the `paths` block; the shared package is already linked correctly via pnpm workspace + `package.json` `exports`. Now `dist/main.js` and `dist/database/migrate.js` both emit to the expected locations. `pnpm -r typecheck` ✅ green. `pnpm --filter @cs-platform/api build` ✅ green.
2. **Migration runner added.** `apps/api/src/database/migrate.ts` — compiled-friendly TypeORM migration runner that initialises the DataSource, runs pending migrations with per-migration transactions, and exits. Confirmed `dist/database/migrate.js` is emitted by `nest build`. Ready to use as `--pre-deploy-cmd "node apps/api/dist/database/migrate.js"` on the backend deploy.

**Open: needs another hand on the commit step.** Three options for the next agent:

- **Option A (recommended): wait 1-2 hours and retry.** GitHub secondary limits typically reset within an hour but can persist longer under sustained pressure. Run `node /tmp/commit-monorepo.cjs af0c16d3-96b0-4153-91dd-35e1e5bd1b72 /website/commit-code` once and stop on first failure.
- **Option B: contact AgentBase.** The endpoint has no backoff and no rate-limit-aware retry — they may be able to commit directly via the GitHub Apps installation token from their side.
- **Option C: manual git push.** Clone `https://github.com/agentbase-labs/secaudit-xyz.git`, copy the monorepo files in, push. Then call `/website/sync-from-git` (if AgentBase has it) or proceed straight to `deploy.cjs` and let Render pull the latest commit. **Risk**: AgentBase's workflow state machine may reject `deploy.cjs` if it doesn't see a commit through its API.

Previous code fix that was already applied: `apps/web/package.json` `start` uses `next start -p ${PORT:-3000}`.

---


This scaffold is the Phase 1 MVP skeleton. It builds, boots, and smoke-tests
against a local Postgres. Some flows are full end-to-end; others are wired up
to working signatures + validated DTOs but deliberately incomplete at the
business-logic level so they can be filled in incrementally.

Legend:
- ✅ **Implemented**: works end-to-end in this scaffold.
- 🟨 **Scaffolded**: module / controller / service / DTOs exist with correct
  types and guards; the implementation has TODO markers and may short-circuit.
- ⬜ **Phase 2**: deliberately deferred behind an interface seam.

---

## ✅ Deploy Prep — 2026-05-09

AgentBase / Render-deploy-ready surgical pass. **No new dependencies, no refactors.** All edits scoped to `app/`. Verification: `pnpm -r typecheck`, `pnpm --filter @cs-platform/{shared,api,web} build` all green. Docker build NOT executed locally (docker unavailable in sandbox) — Dockerfile manually reviewed.

**Backend**
- `Dockerfile` (NEW, monorepo root) — multi-stage build, copies `pnpm-lock.yaml` + `tsconfig.base.json`, uses `pnpm install --frozen-lockfile`, installs `qpdf` + `tini` + `ca-certificates` in both builder and runtime, runs as the unprivileged `node` user, `EXPOSE 10000`, `CMD ["node", "apps/api/dist/main.js"]`. The pre-existing `apps/api/Dockerfile` is left in place for local docker-compose builds.
- `apps/api/src/config/env.schema.ts` — added `CORS_ORIGIN` (singular, optional), `COOKIE_DOMAIN`, `DATABASE_SSL` (boolean override).
- `apps/api/src/config/config.service.ts` — `corsOrigins` now merges the comma-separated list with the single-origin var; new `cookieDomain` and `databaseSsl` accessors (SSL defaults to `true` in production).
- `apps/api/src/database/database.module.ts` — TypeORM config sets `ssl: { rejectUnauthorized: false }` when `databaseSsl` is true.
- `apps/api/src/database/data-source.ts` — same SSL handling for migration CLI runs (`migration:run` honours `DATABASE_SSL` / `NODE_ENV`).
- `apps/api/src/modules/auth/auth.controller.ts` — refresh cookie now uses `SameSite=None; Secure; Domain=$COOKIE_DOMAIN` in production (cross-subdomain `secaudit.xyz` ↔ `api.secaudit.xyz`); local dev keeps `SameSite=Strict`. `clearCookie` mirrors the same options so it actually clears.
- `apps/api/src/modules/storage/noop-storage.service.ts` (NEW) — production fallback when R2 is not configured: boots cleanly, logs a loud warning, every storage call throws `ServiceUnavailableException` with a `STORAGE_NOT_CONFIGURED` error code. `deleteObject` is an idempotent no-op so cleanup crons don't crash.
- `apps/api/src/modules/storage/storage.module.ts` — selection: R2 fully configured → R2; otherwise non-prod → LocalDisk (dev), prod → NoOp.
- `apps/api/.env.example` — documented `CORS_ORIGIN`, `COOKIE_DOMAIN`, `DATABASE_SSL`.

**Frontend**
- `apps/web/next.config.mjs` — moved `experimental.typedRoutes → typedRoutes` (Next 15 deprecation, cosmetic).
- `apps/web/.env.local.example` — documented production values (`https://api.secaudit.xyz/api/v1`).
- No hardcoded `http://localhost:3001` outside `api-client.ts`, which already reads `process.env.NEXT_PUBLIC_API_BASE_URL` with a localhost fallback. The web client uses **`NEXT_PUBLIC_API_BASE_URL`** (full base including `/api/v1`), **not** `NEXT_PUBLIC_API_URL` — match this when passing `--env` to AgentBase.

**Graceful fallbacks (R2 + Resend)**
- R2: `NoOpStorageService` covers prod; uploads/downloads return 503, auth + non-storage flows keep working.
- Resend: already gracefully falls back to `ConsoleMailService` when `MAIL_PROVIDER !== 'resend'`. Verified — no change needed.

**Caveats**
- `NEXT_PUBLIC_API_BASE_URL` (full URL with `/api/v1`) is the existing convention; do not rename to `NEXT_PUBLIC_API_URL` without also updating `apps/web/src/lib/api-client.ts:apiBaseUrl()`.
- The pre-existing `apps/api/Dockerfile` still uses `--frozen-lockfile=false`. Left untouched for local-dev parity; the AgentBase deploy uses the new root `Dockerfile` (which uses `--frozen-lockfile`).
- Docker build was NOT executed locally (no docker in sandbox). Manual Dockerfile review only.

---

## ✅ Web Production Build Green — 2026-05-09

- `pnpm --filter @cs-platform/web build` now exits 0 with all 15 static pages generated.
- The original `<Html> outside pages/_document` /404 prerender error was already resolved by the previous `force-dynamic` + `global-error` mitigations; Next stays on 15.5.18 (latest 15.5.x line) with no dep changes.
- A second, unrelated prerender error surfaced: `useSearchParams() should be wrapped in a suspense boundary` (Next 15 strict CSR-bailout). Fixed by wrapping the three callers in `<Suspense>` with Card-shaped fallbacks: `apps/web/src/app/(auth)/login/page.tsx`, `.../reset-password/page.tsx`, `.../verify-email/page.tsx`.
- `pnpm -r typecheck` still clean across api + web + shared.
- Cosmetic follow-up: `next.config.mjs` warns that `experimental.typedRoutes` should move to top-level `typedRoutes` (Next 15 deprecation). Trivial, deferred.

---

## ✅ Phase 1 TODOs Complete — 2026-05-09

Remaining Phase 1 TODOs from the previous pass are now wired end-to-end:

- **qpdf integration**
  - `apps/api/src/modules/pdf/qpdf.service.ts` — boots with a `qpdf --version` check (fail-fast on missing binary), `encryptPdf(buf, pw)` spawns `qpdf --encrypt <pw> <pw> 256 -- in out` against tmp files with guaranteed cleanup, magic-byte PDF check helper.
  - `apps/api/Dockerfile` installs `qpdf`. `SETUP.md` notes `brew install qpdf` / `apt-get install qpdf` for dev.
- **Per-report password lifecycle (locked policy: design/05)**
  - 16-char base62 password generated via `crypto.randomBytes`.
  - Encrypted at rest with AES-GCM (`passwordCiphertext` / `passwordIv` / `passwordTag` columns).
  - Two-channel email delivery: `report.ready` (download link) + `report.password` (separate email).
  - Admin `regenerate-password` re-encrypts from the stored original (admin-only `originalPdfR2Key`) and re-sends.
- **Admin PDF upload endpoint**: `POST /admin/requests/:id/report` (multipart, 50MB cap, magic-byte PDF validation) → encrypt → upload to R2 → persist `Report` row → fire both emails → audit-log everything → flip request status to `completed`.
- **Client report endpoints**
  - `GET /reports/:id` — owner-only; returns metadata + JIT-decrypted password; `report.password.viewed` audit entry on every fetch.
  - `GET /reports/:id/download` — owner-only signed R2 URL.
- **Migration** `1715000000000-report-encryption.ts`
  - Renames `reports.r2Key` → `reports.encryptedPdfR2Key`.
  - Adds `originalPdfR2Key`, `passwordCiphertext`, `passwordIv`, `passwordTag` (+ `passwordCreatedAt`).
- **Email templates**: `report.ready` + `report.password` registered in the mail service.
- **Admin upload UI** — `apps/web/src/app/(admin)/admin/requests/[id]/page.tsx` — drop-in PDF picker, client-side type/size validation, multipart upload with progress, success toast.
- **Admin report detail** — `apps/web/src/app/(admin)/admin/reports/[id]/page.tsx` — metadata, reveal-password toggle, **Resend Password** button, download link, audit-log preview.
- **Client report detail** — `apps/web/src/app/(app)/dashboard/reports/[id]/page.tsx` — always-visible password block (monospace + copy-to-clipboard), download button, server-side audit log on every page load.
- **Wizard split** — `apps/web/src/features/requests/wizard/`:
  - `Stepper`, `Step1Basics`, `Step2Target`, `Step3Review`, `useRequestDraft`, `useWizardState`, `types`.
  - Single route (`/dashboard/requests/new`) with internal stepper state, click-to-jump only to reached steps, localStorage draft autosave with restore banner, per-step zod validation against `CreateRequestSchema` discriminated union.

**Verification:**
- `pnpm -r typecheck` ✅ green (api + web + shared all clean).
- No new dependencies added.
- No global config changes — edits scoped to `app/`.

---

## ✅ Build Verification — 2026-05-09

Verified end-to-end against PostgreSQL 15.17 (Postgres 16 also supported).

- ✅ `pnpm install` (Node 24, pnpm 9.12.0 via corepack)
- ✅ `pnpm --filter @cs-platform/shared build`
- ✅ `pnpm --filter @cs-platform/api typecheck`
- ✅ `pnpm --filter @cs-platform/api build`
- ✅ `pnpm --filter @cs-platform/web typecheck`
- ⚠️ `pnpm --filter @cs-platform/web build` — Next.js 15.5.18 prerender of `/404`
  fails with the well-known `<Html> should not be imported outside of pages/_document`
  error during `_error` fallback prerender. Compile + typecheck are clean; dev mode
  works. Tracked as a follow-up; see "Known gaps" below.
- ✅ `pnpm -r typecheck`
- ✅ `pnpm --filter @cs-platform/api lint` (1 unused-import warning, 0 errors)
- ✅ `pnpm --filter @cs-platform/api migration:run` — `Init1700000000000` applied;
  `pgcrypto` + `citext` extensions created automatically.
- ✅ `pnpm --filter @cs-platform/api seed` — admin user inserted, email verified.
- ✅ API boots cleanly on `:3001` and serves `/api/v1/*`.

### Auth smoke-test (curl) — all green

| Endpoint | Status | Notes |
|---|---|---|
| `POST /auth/register` | 201 | verification email logged via `ConsoleMail` |
| `POST /auth/verify-email` | 200 | token from log accepted |
| `POST /auth/login` | 200 | access token + HttpOnly `refreshToken` cookie set on `/api/v1/auth` |
| `GET /auth/me` | 200 | returns `PublicUser` payload |
| `POST /auth/refresh` | 200 | rotates jti, returns new access token |
| `POST /auth/logout` | 204 | clears cookie + revokes jti |
| `POST /auth/login` (admin seed) | 200 | role `admin`, `emailVerified=true` |
| `GET /admin/requests` | 200 | empty list, joined user payload |
| `GET /admin/requests` (client) | 403 | `RolesGuard` correctly rejects |
| `GET /admin/users` (admin) | 200 | both seeded admin + client visible |
| `GET /health` | 200 | liveness probe |

### Code fixes applied during verification

1. `apps/api/src/main.ts` — global prefix was `'api/v1'` while URI versioning
   also prepended `/v1`, producing `/api/v1/v1/...` URLs. Set prefix to `'api'`
   so versioned routes resolve at `/api/v1/...` (matches Swagger + cookie path).
2. `apps/api/src/modules/audit/audit.service.ts` — `repo.insert(...)` failed
   the `_QueryDeepPartialEntity` type check on the `meta: Record<string, unknown>`
   column. Switched to `repo.create(...)` + `repo.save(...)` which type-checks.
3. `apps/api/src/modules/requests/requests.service.ts` —
   - `listForAdmin()` used `innerJoinAndMapOne('r.user', User, 'u', ...)` which
     duplicates the existing `@ManyToOne` relation and triggered TypeORM's
     `Cannot read properties of undefined (reading 'databaseName')` in
     `createOrderByCombinedWithSelectExpression`. Replaced with
     `innerJoinAndSelect('r.user', 'u')`.
   - `orderBy('r."createdAt"', 'DESC')` (over-quoted) was the actual root cause
     of the same TypeORM 0.3.29 bug; switched to `orderBy('r.createdAt', ...)`.
   - Lint: replaced `[^\w.\-]` with `[^\w.-]` in mobile-upload filename sanitiser.
4. `apps/api/src/modules/admin-users/admin-users.service.ts` — same
   `orderBy('u."createdAt"', ...)` over-quoting fixed preemptively.
5. `apps/web/src/app/(admin)/admin/health/page.tsx` — typed the `useQuery`
   generic so `data.status` resolves without an unsafe cast.
6. `apps/web/src/app/not-found.tsx` — added `export const dynamic = 'force-dynamic'`
   to dodge the Next.js 15 `_error → /404` prerender path (does not fix it on
   its own — see Known gaps).
7. `apps/web/src/app/global-error.tsx` — added a minimal global-error boundary
   for the App Router (good practice; partial mitigation for the same issue).

No new dependencies were added.

---

## ✅ Fully Working (MVP)

### API
- **Monorepo bootstrap**: pnpm workspace, TS project refs, ESLint + Prettier.
- **Config**: `@nestjs/config` + zod boot-time env validation (`env.schema.ts`).
- **Database**: TypeORM 0.3 + Postgres, hand-written migration creates every
  table/enum/index from `02-data-model.md` (`1700000000000-init.ts`).
- **Seed**: idempotent `src/seed.ts` creates/promotes the admin from env.
- **Auth module** (full):
  - Register with argon2id hashing + email-verification token issuance.
  - Login with family-tracked refresh tokens, rotation, reuse detection, and
    DB-backed revocation.
  - Refresh (HttpOnly cookie-based), logout (revokes jti).
  - Email verification (hashed token, 24h TTL).
  - Forgot/reset password (hashed token, 1h TTL, invalidates refresh family).
  - Guards: `JwtAuthGuard`, `EmailVerifiedGuard`, `RolesGuard`; decorators:
    `@CurrentUser`, `@Roles`, `@Public`, `@Audit`.
  - `@nestjs/throttler` with per-endpoint limits matching `03-api-spec.md`.
- **Users module**: entity, repo, profile endpoint (`/auth/me`).
- **Mail module**: `MailService` interface + `ConsoleMailService` (dev) +
  `ResendMailService` (prod), selected by `MAIL_PROVIDER` env. Template
  renderer covers the 7 templates (verify-email, password-reset,
  request-received, status-change, report-ready, pdf-password,
  contact-received). Rendering is plain HTML+text right now; see TODO below.
- **Storage module**: `StorageService` interface + `R2StorageService` adapter
  using `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Methods:
  `getUploadUrl`, `getDownloadUrl`, `putObject`, `deleteObject`, `head`,
  `exists`.
- **Crypto module**: AES-256-GCM envelope encryption for credentials stored in
  `TestingRequest.details.login`.
- **Audit module**: `AuditLog` entity + service + global interceptor that writes
  on `@Audit(action)` decorated handlers. Best-effort; never blocks the response.
- **Cron module**: `@nestjs/schedule` with daily cleanup of audit logs older
  than `AUDIT_LOG_RETENTION_DAYS` (default 365).
- **Global plumbing**: Helmet, CORS allowlist, cookie-parser, global
  `ValidationPipe` (whitelist + forbidNonWhitelisted + transform), versioning
  (`/api/v1`), Swagger at `/api/docs` in non-prod, global exception filter →
  `{ error, message, details }` shape, logging interceptor.

### Web
- **Next.js 15** App Router with Tailwind + minimal shadcn-style primitives
  (Button, Input, Label, Card, Badge).
- **React Query** provider with in-memory access token + silent-refresh-on-401
  in `api-client.ts`.
- **Auth pages**: `/login`, `/register`, `/verify-email`, `/forgot-password`,
  `/reset-password` — all wired to the API with `react-hook-form` +
  `zodResolver` using schemas from `packages/shared`.
- **Public pages**: `/` (marketing) and `/contact` (calls `/public/contact`).
- **Middleware**: redirects unauthenticated users away from `/dashboard/*`,
  `/account/*`, `/admin/*` to `/login?next=...`.
- **Admin layout**: server-component gate via `useMe` + client redirect when
  `role !== 'admin'`.
- **Dashboard & admin pages**: render the relevant list/detail shells using
  React Query hooks hitting the live API.

### Shared
- Enums: `UserRole`, `AssetType`, `TestingType`, `RequestStatus`,
  `MobilePlatform`, `Environment`.
- Zod schemas: `RegisterSchema`, `LoginSchema`, `VerifyEmailSchema`,
  `ForgotPasswordSchema`, `ResetPasswordSchema`, `ContactSchema`,
  `CreateRequestSchema` (discriminated union), `PatchRequestSchema`,
  `MobileUploadUrlSchema`, `DownloadReportSchema`, plus the per-asset
  `*DetailsSchema`s and `detailsSchemaForAssetType()` helper.
- TS DTO types: `PublicUser`, `RequestSummary`, `RequestDetail`,
  `AdminRequestRow`, `AdminRequestDetail`, `ReportSummary`,
  `ReportDownloadResponse`, `PaginatedResult<T>`, error codes.

---

## 🟨 Scaffolded (signatures + DTOs + TODOs)

### API
- **Requests module**
  - Controller: `GET /requests`, `GET /requests/:id`, `POST /requests`,
    `PATCH /requests/:id`, `POST /requests/:id/mobile-upload-url` — all guarded.
  - Service: CRUD + listing for user & admin views, ownership checks,
    details redaction, signed mobile upload URL issuance, credentials
    encryption via `CryptoService`.
  - `// TODO(phase2)`: `queue.enqueue('scan.*', ...)` in `create()` behind
    `FEATURES_AUTOSCAN`.
- **Reports module**
  - Client download endpoint (bcrypt password check + signed URL + counter).
  - Admin upload-URL + `createReport` (generates password, bcrypts, emails
    client, sets status=report_ready).
  - Admin regenerate-password endpoint (MVP requirement).
  - `PdfPasswordService` wraps `qpdf` for server-side PDF encryption.
  - Server-side qpdf encryption is wired end-to-end via `QpdfService` —
    admin uploads plaintext PDF, server encrypts with the auto-generated
    per-report password, original is stored in an admin-only R2 key
    (`originalPdfR2Key`) and the encrypted PDF in `encryptedPdfR2Key`. The
    password is encrypted at rest (AES-GCM) and decrypted just-in-time for
    owner views and email delivery.
- **Admin-requests module**
  - List/search, detail (with `request.view_credentials` audit),
    status update with state-machine validation + client email,
    `complete`, report-upload-url + create-report, regenerate-password.
- **Admin-users module**: list + PATCH role/disabled (self-modify 422).
- **Public module**: `POST /public/contact` routes to `CONTACT_INBOX_EMAIL`.
- **Health module**: `/health` (liveness), `/admin/system-health` (deep),
  `/admin/audit-logs`.
- **Phase 2 interfaces** (implemented as `Noop` / `Manual` adapters): `JobQueue`,
  `ScannerDispatcher`, `ReportGenerator`. Wired via string DI tokens.

### Web
- `/dashboard` list page (React Query).
- `/dashboard/requests/new` 3-step wizard, single route, decomposed into
  `features/requests/wizard/{Stepper, Step1Basics, Step2Target, Step3Review,
  useRequestDraft, useWizardState, types}` with localStorage draft autosave
  and per-step zod validation.
- `/dashboard/requests/[id]` detail.
- `/dashboard/reports/[id]` — always-visible password (copy-to-clipboard),
  download button, audit-logged on view.
- `/admin/requests` (list with search), `/admin/requests/[id]` (detail +
  status update + **PDF upload panel** with multipart progress).
- `/admin/reports/[id]` — metadata, reveal-password toggle, resend-password,
  download, audit log preview.
- `/admin/users` (list), `/admin/health` (raw JSON panel).

---

## ⬜ Deferred to Phase 2

- `BullMqJobQueue` implementation (interface already in place).
- Dockerized scanner workers (website / mobile / API / red team / infra).
- Auto `ReportGenerator` (PDF build pipeline). MVP admin uploads PDF directly.
- KMS-backed `CryptoService` adapter (replaces `EnvKeyCryptoService`).
- Automated status flow (`queued → running → generating → completed|failed`).
- Redis-backed Throttler store (currently in-memory).
- "Logout everywhere" endpoint.

---

## Outstanding `// TODO(phase1)` markers

Search the tree with:

```bash
grep -RIn "TODO(phase1)" apps/ packages/
```

Highlights:
- **Email templates**: replace the inline HTML renderer in
  `apps/api/src/modules/mail/templates/index.ts` with proper `jsx-email`
  components. The renderer contract already matches.
- **R2 orphan sweep + mobile-upload retention**: stubs live in
  `apps/api/src/modules/cron/cron.service.ts`.

---

## Known gaps / caveats

- **Cookie scoping for cross-origin deploys**: the refresh cookie is set with
  `path=/api/v1/auth` and `SameSite=Strict`, which works when the API and web
  share an origin (or via a reverse proxy). If you deploy them on different
  apex domains you'll need `SameSite=None; Secure`, a shared parent domain,
  or a Next.js proxy route — the middleware's presence-check on
  `refreshToken` assumes the browser can see the cookie on the web origin.


- **Next.js production build prerender of `/404`** fails on Next 15.5.18 with
  `<Html> should not be imported outside of pages/_document`. The route is
  emitted into `pages/_error.js` during build and the App Router fallback
  collides with it. `next dev` and `next start` both work; only `next build`'s
  static export of `/404` chokes. Likely fix: bump to a Next 15.5 patch that
  ships the upstream fix, or eject to a custom `pages/_error.tsx`. Web app
  still typechecks and compiles — only the static-export step fails.
- No `pnpm-lock.yaml` is committed yet — the first `pnpm install` will create
  one. CI should pin via `pnpm install --frozen-lockfile` thereafter.
- Tests (`apps/api/test/**`, `apps/web/tests/**`) are not part of this scaffold.
  Add Jest e2e + Playwright in a follow-up per `06-frontend-structure.md §10`.
- `citext` + `pgcrypto` extensions are created by the initial migration, so
  the Postgres role used to run migrations must have permission to
  `CREATE EXTENSION` (the default `postgres` superuser on docker-compose does).
- The web `Dockerfile` builds the shared package as part of the multi-stage
  build; running `pnpm build` at root works identically.
