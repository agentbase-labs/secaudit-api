import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

import { AuditModule } from './modules/audit/audit.module';
import { CryptoModule } from './modules/crypto/crypto.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { StorageModule } from './modules/storage/storage.module';
import { MailModule } from './modules/mail/mail.module';
import { QueueModule } from './modules/queue/queue.module';
import { ScannersModule } from './modules/scanners/scanners.module';

import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { RequestsModule } from './modules/requests/requests.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminRequestsModule } from './modules/admin-requests/admin-requests.module';
import { AutoScanModule } from './modules/auto-scan/auto-scan.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { PublicModule } from './modules/public/public.module';
import { HealthModule } from './modules/health/health.module';
import { CronModule } from './modules/cron/cron.module';
import { PlansModule } from './modules/plans/plans.module';
import { DemoScanModule } from './modules/demo-scan/demo-scan.module';
import { ActiveScanModule } from './modules/active-scan/active-scan.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,

    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60 * 1000, limit: 60 }, // 60 req / 60s / IP global
    ]),

    // Global infrastructure
    AuditModule,
    CryptoModule,
    PdfModule,
    StorageModule,
    MailModule,
    QueueModule,
    ScannersModule,

    // Domain
    UsersModule,
    AuthModule,
    RequestsModule,
    ReportsModule,
    AdminRequestsModule,
    AutoScanModule,
    AdminUsersModule,
    PublicModule,
    HealthModule,
    CronModule,
    PlansModule,
    DemoScanModule,
    ActiveScanModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
