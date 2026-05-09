import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cfg: AppConfigService,
  ) {}

  async liveness() {
    return { status: 'ok' };
  }

  async deep() {
    const db = await this.pingDb();
    // TODO(phase1): add r2 / mail / queue pings by calling their adapters' health methods.
    return {
      status: db.ok ? 'ok' : 'degraded',
      db,
      r2: { ok: Boolean(this.cfg.get('R2_ENDPOINT')), latencyMs: 0, adapter: 'r2' },
      mail: { ok: true, provider: this.cfg.get('MAIL_PROVIDER') },
      queue: { ok: true, adapter: 'noop' },
      version: '1.0.0',
      uptimeSec: Math.round(process.uptime()),
    };
  }

  private async pingDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }
}
