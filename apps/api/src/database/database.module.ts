import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/config.service';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        type: 'postgres',
        url: cfg.get('DATABASE_URL'),
        // Render Postgres (and most managed Postgres providers) require
        // TLS, but ship a self-signed chain. Mirror what data-source.ts
        // does for migrations.
        ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : false,
        entities: [path.join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}')],
        migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
        migrationsRun: false,
        synchronize: false,
        autoLoadEntities: true,
        logging: cfg.isProd ? ['error'] : ['error', 'warn'],
      }),
    }),
  ],
})
export class DatabaseModule {}
