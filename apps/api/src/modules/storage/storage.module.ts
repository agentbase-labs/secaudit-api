import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { NoOpStorageService } from './noop-storage.service';
import { R2StorageService } from './r2-storage.service';
import { STORAGE_SERVICE } from './storage.service';

/**
 * StorageService selection at boot:
 *   - R2 env fully populated         → R2StorageService
 *   - NODE_ENV !== 'production'      → LocalDiskStorageService (DEV)
 *   - NODE_ENV === 'production'      → NoOpStorageService (clean 503s)
 *
 * The NoOp branch keeps the API booting on environments where R2 is
 * intentionally disabled (e.g. early deploys, paused services), so
 * auth + non-storage flows still work; only file ops fail with 503.
 */
@Global()
@Module({
  providers: [
    R2StorageService,
    LocalDiskStorageService,
    NoOpStorageService,
    {
      provide: STORAGE_SERVICE,
      inject: [
        AppConfigService,
        R2StorageService,
        LocalDiskStorageService,
        NoOpStorageService,
      ],
      useFactory: (
        cfg: AppConfigService,
        r2: R2StorageService,
        local: LocalDiskStorageService,
        noop: NoOpStorageService,
      ) => {
        const endpoint = cfg.get('R2_ENDPOINT');
        const accessKeyId = cfg.get('R2_ACCESS_KEY_ID');
        const secretAccessKey = cfg.get('R2_SECRET_ACCESS_KEY');
        const fullyConfigured = Boolean(
          endpoint &&
            !endpoint.includes('<accountId>') &&
            accessKeyId &&
            secretAccessKey,
        );
        if (fullyConfigured) return r2;
        return cfg.isProd ? noop : local;
      },
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
