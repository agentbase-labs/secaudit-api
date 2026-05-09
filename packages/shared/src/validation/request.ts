import { z } from 'zod';
import { AssetType, TestingType } from '../enums';
import {
  AttackSurfaceDetailsSchema,
  ExternalInfraDetailsSchema,
  MobileAppDetailsSchema,
  WebsiteDetailsSchema,
} from './request-details';

/**
 * Create-request schema: a true discriminated union keyed on assetType.
 * `details` is validated against the matching schema for the assetType.
 */
export const CreateRequestSchema = z.discriminatedUnion('assetType', [
  z.object({
    assetType: z.literal(AssetType.WEBSITE),
    testingType: z.nativeEnum(TestingType),
    details: WebsiteDetailsSchema,
  }),
  z.object({
    assetType: z.literal(AssetType.MOBILE_APP),
    testingType: z.nativeEnum(TestingType),
    details: MobileAppDetailsSchema,
  }),
  z.object({
    assetType: z.literal(AssetType.ATTACK_SURFACE),
    testingType: z.nativeEnum(TestingType),
    details: AttackSurfaceDetailsSchema,
  }),
  z.object({
    assetType: z.literal(AssetType.EXTERNAL_INFRA),
    testingType: z.nativeEnum(TestingType),
    details: ExternalInfraDetailsSchema,
  }),
]);
export type CreateRequestInput = z.infer<typeof CreateRequestSchema>;

/**
 * Patch-request schema: only allowed during status=submitted.
 * Partial details are merged server-side then re-validated.
 */
export const PatchRequestSchema = z
  .object({
    details: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Empty body' });
export type PatchRequestInput = z.infer<typeof PatchRequestSchema>;

/**
 * Mobile upload URL DTO.
 */
export const MobileUploadUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum([
    'application/vnd.android.package-archive',
    'application/octet-stream',
    'application/zip',
  ]),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024, 'File too large (max 500 MB)'),
});
export type MobileUploadUrlInput = z.infer<typeof MobileUploadUrlSchema>;

/**
 * Download report DTO (password required).
 */
export const DownloadReportSchema = z.object({
  password: z.string().min(1).max(200),
});
export type DownloadReportInput = z.infer<typeof DownloadReportSchema>;
