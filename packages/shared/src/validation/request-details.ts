import { z } from 'zod';
import { AssetType, Environment, MobilePlatform } from '../enums';

// Website details
// `.strict()` rejects unknown keys — defense-in-depth so a leaky wizard state
// can't smuggle fields from a different asset type into the persisted row.
export const WebsiteDetailsSchema = z
  .object({
    url: z.string().trim().url('Must be a valid URL').max(2048),
    env: z.nativeEnum(Environment),
    login: z
      .object({
        username: z.string().min(1).max(200),
        password: z.string().min(1).max(500),
        notes: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type WebsiteDetails = z.infer<typeof WebsiteDetailsSchema>;

// Mobile app details
export const MobileAppDetailsSchema = z
  .object({
    platform: z.nativeEnum(MobilePlatform),
    appName: z.string().trim().min(1).max(200),
    packageName: z.string().trim().min(1).max(200),
    storeLink: z.string().trim().url().max(2048).optional().or(z.literal('')),
    env: z.nativeEnum(Environment),
    mobileFileKey: z.string().max(500).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type MobileAppDetails = z.infer<typeof MobileAppDetailsSchema>;

// Attack surface details
export const AttackSurfaceDetailsSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .min(3)
      .max(253)
      .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/, {
        message: 'Invalid domain',
      }),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type AttackSurfaceDetails = z.infer<typeof AttackSurfaceDetailsSchema>;

// External infra details
export const ExternalInfraDetailsSchema = z
  .object({
    ips: z
      .array(z.string().trim().min(1).max(100))
      .min(1, 'Provide at least one IP or CIDR')
      .max(256),
    notes: z.string().max(5000).optional(),
  })
  .strict();
export type ExternalInfraDetails = z.infer<typeof ExternalInfraDetailsSchema>;

/**
 * Discriminated union by assetType. Keep in sync with AssetType enum.
 *
 * NOTE: the shape is a plain union validated alongside assetType at the
 * `create-request` level, because TestingRequest.details is stored alone
 * in JSONB without the assetType discriminator.
 */
export const RequestDetailsSchema = z.union([
  WebsiteDetailsSchema,
  MobileAppDetailsSchema,
  AttackSurfaceDetailsSchema,
  ExternalInfraDetailsSchema,
]);
export type RequestDetails =
  | WebsiteDetails
  | MobileAppDetails
  | AttackSurfaceDetails
  | ExternalInfraDetails;

/** Look up the correct schema based on assetType. */
export function detailsSchemaForAssetType(assetType: AssetType) {
  switch (assetType) {
    case AssetType.WEBSITE:
      return WebsiteDetailsSchema;
    case AssetType.MOBILE_APP:
      return MobileAppDetailsSchema;
    case AssetType.ATTACK_SURFACE:
      return AttackSurfaceDetailsSchema;
    case AssetType.EXTERNAL_INFRA:
      return ExternalInfraDetailsSchema;
    default: {
      const _exhaustive: never = assetType;
      throw new Error(`Unhandled asset type: ${String(_exhaustive)}`);
    }
  }
}
