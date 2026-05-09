import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import type { AppEnv } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: NestConfigService<AppEnv, true>) {}

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key, { infer: true }) as AppEnv[K];
  }

  get nodeEnv() {
    return this.get('NODE_ENV');
  }
  get isProd() {
    return this.nodeEnv === 'production';
  }
  get corsOrigins(): string[] {
    const fromList = this.get('CORS_ORIGINS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const single = this.get('CORS_ORIGIN').trim();
    const all = single ? [...fromList, single] : fromList;
    // de-dupe while preserving order
    return Array.from(new Set(all));
  }

  get cookieDomain(): string | undefined {
    const v = this.get('COOKIE_DOMAIN').trim();
    return v.length > 0 ? v : undefined;
  }

  /**
   * When true, registration sends a verification email and login refuses
   * unverified accounts. When false (default), users are auto-verified on
   * registration and can log in immediately.
   */
  get emailVerificationRequired(): boolean {
    return this.get('EMAIL_VERIFICATION_REQUIRED');
  }

  /**
   * Whether TypeORM should negotiate TLS to Postgres. Defaults to true in
   * production (Render Postgres + most managed DBs require it) and false
   * locally, but the `DATABASE_SSL` env can override either way.
   */
  get databaseSsl(): boolean {
    const explicit = this.get('DATABASE_SSL');
    if (typeof explicit === 'boolean') return explicit;
    return this.isProd;
  }
}
