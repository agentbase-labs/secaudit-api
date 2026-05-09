import { z } from 'zod';
import { RequestStatus, UserRole } from '../enums';

export const UpdateRequestStatusSchema = z.object({
  status: z.nativeEnum(RequestStatus),
  note: z.string().max(2000).optional(),
});
export type UpdateRequestStatusInput = z.infer<typeof UpdateRequestStatusSchema>;

export const ReportUploadUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.literal('application/pdf'),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024, 'Report too large (max 100 MB)'),
});
export type ReportUploadUrlInput = z.infer<typeof ReportUploadUrlSchema>;

export const CreateReportSchema = z.object({
  r2Key: z.string().min(1).max(500),
  fileSize: z.number().int().positive(),
  /**
   * When true: admin pre-encrypted the PDF (client-side before upload).
   * When false: server will encrypt using qpdf (owner+user password).
   * Default: server-side encryption (PDF_SERVER_ENCRYPT=true).
   */
  pdfSelfEncrypted: z.boolean().optional().default(false),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

export const UpdateUserSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, {
    message: 'Provide role or disabled',
  });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
