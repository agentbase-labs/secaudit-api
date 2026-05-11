import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  });

const positiveInt = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().int().min(0));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => Number(v ?? 3001))
    .pipe(z.number().int().positive()),

  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:3001'),
  // CORS_ORIGINS = comma-separated list (multiple allowed origins).
  // CORS_ORIGIN  = single-origin convenience var; if set, it is appended
  //               to CORS_ORIGINS by AppConfigService.corsOrigins.
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  CORS_ORIGIN: z.string().optional().default(''),

  // Optional cookie domain for cross-subdomain refresh-cookie scoping in
  // production (e.g. `.secaudit.xyz` so it works on app.secaudit.xyz +
  // api.secaudit.xyz, and the apex if it ever needs the cookie).
  COOKIE_DOMAIN: z.string().optional().default(''),

  // Force TypeORM to negotiate TLS to Postgres (Render Postgres requires
  // SSL but presents a self-signed chain, hence rejectUnauthorized=false).
  // Defaults to true in production, false elsewhere.
  DATABASE_SSL: booleanString.optional(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  CREDS_ENCRYPTION_KEY: z
    .string()
    .min(32, 'CREDS_ENCRYPTION_KEY must be a 32-byte base64 string')
    .default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='), // dev fallback

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().min(8).optional(),
  ADMIN_FULL_NAME: z.string().min(1).default('Platform Admin'),

  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default('cs-platform-dev'),
  R2_ENDPOINT: z.string().optional().default(''),

  MAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional().default(''),
  FROM_EMAIL: z.string().email().default('no-reply@example.com'),
  CONTACT_INBOX_EMAIL: z.string().email().default('contact@example.com'),
  // Optional aliases used by ResendMailService. If unset, FROM_EMAIL
  // and CONTACT_INBOX_EMAIL (or ADMIN_EMAIL) are used as fallbacks.
  RESEND_FROM_EMAIL: z.string().optional().default(''),
  RESEND_ADMIN_EMAIL: z.string().optional().default(''),

  REDIS_URL: z.string().optional().default(''),

  MOBILE_UPLOAD_RETENTION_DAYS: positiveInt.default(30),
  REPORT_RETENTION_DAYS: positiveInt.default(0),
  AUDIT_LOG_RETENTION_DAYS: positiveInt.default(365),

  PDF_SERVER_ENCRYPT: booleanString.default(true),
  QPDF_BINARY: z.string().default('qpdf'),

  FEATURES_AUTOSCAN: booleanString.default(false),

  // When true, the auto-scan orchestrator runs Tier 2 scanners
  // (nuclei + nikto) after Tier 1 succeeds. When false (default), Tier 2
  // is skipped entirely and the run is marked `complete` on Tier 1
  // success. Disabled by default because Tier 2 caused fresh scans to
  // hang on Render starter (512MB RAM, likely OOM during nuclei template
  // load). Re-enable once the orchestrator is hardened or the Render
  // plan is upgraded.
  AUTOSCAN_TIER_2_ENABLED: booleanString.default(false),

  // When true, /auth/register issues a verification email and /auth/login
  // refuses to sign in users whose email is not yet verified. When false
  // (default), new users are flagged `emailVerified=true` on creation, no
  // verification email is sent, and login skips the verified-email gate.
  // Toggle on once a real outbound mail provider (Resend) is wired.
  EMAIL_VERIFICATION_REQUIRED: booleanString.default(false),

  // Master kill-switch for plan-cap enforcement. When 'false' (default),
  // every plan-related guard short-circuits to allow the request. Flip to
  // 'true' in a separate deploy after Step 6 of the rollout plan
  // (`design/plans/03-plan-engineering.md` §8). Stored as a string
  // (matches the engineering doc) so the toggle is unambiguously textual
  // in deploy panels.
  PLAN_CAPS_ENFORCED: z.string().default('false'),
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
