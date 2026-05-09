export const MAIL_SERVICE = 'MailService';

export type EmailTemplate =
  | 'verify-email'
  | 'password-reset'
  | 'request-received'
  | 'status-change'
  | 'report-ready'
  | 'pdf-password'
  | 'contact-received';

export interface EmailTemplateData {
  'verify-email': { fullName: string; verifyUrl: string; expiresHours: number };
  'password-reset': { fullName: string; resetUrl: string; expiresHours: number };
  'request-received': {
    fullName: string;
    requestId: string;
    assetType: string;
    dashboardUrl: string;
  };
  'status-change': {
    fullName: string;
    requestId: string;
    newStatus: string;
    note?: string;
    dashboardUrl: string;
  };
  /**
   * Email A — "Your report is ready" (download link only, NO password).
   * Per "PDF Password Policy (locked 2026-05-09)" the password ships in
   * a separate `pdf-password` email.
   */
  'report-ready': {
    fullName: string;
    requestId: string;
    reportId: string;
    downloadUrl: string;
  };
  /**
   * Email B — "Your report password" (separate message, contains password).
   */
  'pdf-password': {
    fullName: string;
    requestId: string;
    reportId: string;
    pdfPassword: string;
    /** Optional reason — populated when an admin regenerates the password. */
    reason?: string;
  };
  'contact-received': {
    name: string;
    email: string;
    companyName?: string;
    message: string;
  };
}

export interface MailService {
  sendTemplate<T extends EmailTemplate>(args: {
    to: string | string[];
    template: T;
    data: EmailTemplateData[T];
    replyTo?: string;
  }): Promise<{ id: string }>;
}
