export interface ReportSummary {
  id: string;
  requestId: string;
  fileSize: string;
  uploadedAt: string;
  downloadCount: number;
  lastDownloadedAt: string | null;
}

export interface ReportDownloadResponse {
  downloadUrl: string;
  expiresAt: string;
  contentType: string;
}

/**
 * Owner-facing report detail. The plaintext PDF password is included so the
 * portal can show a "copy" affordance per the locked password policy
 * (2026-05-09). Every fetch where `password !== null` is audit-logged
 * server-side as `report.password.viewed`.
 */
export interface ReportDetailForOwner extends ReportSummary {
  password: string | null;
  passwordCreatedAt: string | null;
}

/** Single audit log entry returned to the admin UI. */
export interface AuditLogEntry {
  id: string;
  action: string;
  actorUserId: string | null;
  createdAt: string;
  meta: Record<string, unknown>;
}

/** Admin-facing report detail (everything in `ReportDetailForOwner` + audit log). */
export interface AdminReportDetail extends ReportDetailForOwner {
  encryptedPdfR2Key: string;
  hasOriginal: boolean;
  uploadedBy: string;
  pdfSelfEncrypted: boolean;
  auditLog: AuditLogEntry[];
}

/** Result of a successful admin upload (`POST /admin/requests/:id/report`). */
export interface AdminReportUploadResult {
  id: string;
  reportId: string;
  password: string;
  encryptedPdfR2Key: string;
}

/** Result of a successful password regeneration. */
export interface AdminPasswordRegenResult {
  reportId: string;
  password: string;
  reEncrypted: boolean;
}
