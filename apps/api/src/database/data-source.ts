import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import * as path from 'path';

// Load .env for CLI commands (migrations etc.)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function shouldUseSsl(): boolean {
  const explicit = process.env.DATABASE_SSL;
  if (explicit !== undefined && explicit !== '') {
    return ['1', 'true', 'yes', 'on'].includes(explicit.trim().toLowerCase());
  }
  return process.env.NODE_ENV === 'production';
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // Required for managed Postgres (Render, Supabase, RDS, ...) which
  // present self-signed chains.
  ssl: shouldUseSsl() ? { rejectUnauthorized: false } : false,
  entities: [path.join(__dirname, '..', 'modules', '**', 'entities', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  migrationsRun: false,
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production' ? ['error', 'warn'] : ['error'],
});
