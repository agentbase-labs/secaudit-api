export const MAIL_SERVICE = 'MailService';

export type EmailTemplate =
  | 'verify-email'
  | 'password-reset'
  | 'request-received'
  | 'status-change'
  | 'report-ready'
  | 'pdf-password'
  | 'contact-received'
  | 'welcome-signup'
  | 'pcr-submitted-user'
  | 'pcr-submitted-admin'
  | 'pcr-approved'
  | 'pcr-rejected';

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
  /**
   * Welcome email — sent on successful registration.
   * planName is the human-readable name ("Free", "Starter", "Pro", …).
   * If the user signed up requesting a paid plan, set pendingUpgrade=true
   * so we can mention "we'll review your upgrade request shortly."
   */
  'welcome-signup': {
    fullName: string;
    planName: string;
    pendingUpgrade?: boolean;
    pendingPlanName?: string;
    dashboardUrl: string;
  };
  /**
   * Plan-change request submitted — confirmation to the user.
   */
  'pcr-submitted-user': {
    fullName: string;
    fromPlanName: string;
    toPlanName: string;
    billingCycle: string;
    dashboardUrl: string;
  };
  /**
   * Plan-change request submitted — notification to the admin inbox.
   * Includes everything ops needs to action it.
   */
  'pcr-submitted-admin': {
    userEmail: string;
    userFullName: string;
    companyName?: string;
    fromPlanName: string;
    toPlanName: string;
    billingCycle: string;
    pcrId: string;
    adminInboxUrl: string;
  };
  /**
   * Admin approved the PCR — user's plan is now active on the new tier.
   */
  'pcr-approved': {
    fullName: string;
    toPlanName: string;
    billingCycle: string;
    notes?: string;
    dashboardUrl: string;
  };
  /**
   * Admin rejected the PCR — explain why.
   */
  'pcr-rejected': {
    fullName: string;
    toPlanName: string;
    notes: string;
    dashboardUrl: string;
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
