/**
 * jsx-email template registry.
 * Templates are React components compiled to HTML via `render()` from jsx-email.
 *
 * TODO(phase1): replace the plain-text renderer below with real jsx-email templates
 * (see https://jsx.email). Keeping text-only for now ensures the scaffold builds
 * with zero runtime deps on React rendering.
 */
import type { EmailTemplate, EmailTemplateData } from '../mail.service';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderTemplate<T extends EmailTemplate>(
  template: T,
  data: EmailTemplateData[T],
): RenderedEmail {
  switch (template) {
    case 'verify-email': {
      const d = data as EmailTemplateData['verify-email'];
      return {
        subject: 'Verify your email',
        html: `<p>Hi ${esc(d.fullName)},</p><p>Please verify your email by clicking <a href="${esc(d.verifyUrl)}">this link</a>. It expires in ${d.expiresHours}h.</p>`,
        text: `Hi ${d.fullName},\n\nPlease verify your email: ${d.verifyUrl}\n(Expires in ${d.expiresHours}h)`,
      };
    }
    case 'password-reset': {
      const d = data as EmailTemplateData['password-reset'];
      return {
        subject: 'Reset your password',
        html: `<p>Hi ${esc(d.fullName)},</p><p>Reset your password <a href="${esc(d.resetUrl)}">here</a>. Expires in ${d.expiresHours}h.</p>`,
        text: `Hi ${d.fullName},\n\nReset your password: ${d.resetUrl}\n(Expires in ${d.expiresHours}h)`,
      };
    }
    case 'request-received': {
      const d = data as EmailTemplateData['request-received'];
      return {
        subject: 'Testing request received',
        html: `<p>Hi ${esc(d.fullName)},</p><p>We received your <strong>${esc(d.assetType)}</strong> testing request (ID <code>${esc(d.requestId)}</code>). View it in your <a href="${esc(d.dashboardUrl)}">dashboard</a>.</p>`,
        text: `Hi ${d.fullName},\n\nWe received your ${d.assetType} testing request (ID ${d.requestId}).\nDashboard: ${d.dashboardUrl}`,
      };
    }
    case 'status-change': {
      const d = data as EmailTemplateData['status-change'];
      return {
        subject: `Request ${d.requestId} status: ${d.newStatus}`,
        html: `<p>Hi ${esc(d.fullName)},</p><p>Your request <code>${esc(d.requestId)}</code> is now <strong>${esc(d.newStatus)}</strong>.${d.note ? `<br/><em>${esc(d.note)}</em>` : ''}</p><p><a href="${esc(d.dashboardUrl)}">Open dashboard</a></p>`,
        text: `Hi ${d.fullName},\n\nYour request ${d.requestId} is now ${d.newStatus}.\n${d.note ?? ''}\nDashboard: ${d.dashboardUrl}`,
      };
    }
    case 'report-ready': {
      // Email A — link only. No password (sent in a separate `pdf-password`
      // email per the locked policy).
      const d = data as EmailTemplateData['report-ready'];
      return {
        subject: 'Your security report is ready',
        html: `<p>Hi ${esc(d.fullName)},</p><p>Your security report for request <code>${esc(d.requestId)}</code> is ready.</p><p><a href="${esc(d.downloadUrl)}">Open the report in your dashboard</a></p><p>The PDF is password-protected. Your password has been sent in a <strong>separate email</strong> for security — keep an eye on your inbox.</p>`,
        text: `Hi ${d.fullName},\n\nYour security report for request ${d.requestId} is ready.\nOpen it in your dashboard: ${d.downloadUrl}\n\nThe PDF is password-protected. Your password has been sent in a separate email.`,
      };
    }
    case 'pdf-password': {
      // Email B — password only. Sent immediately after `report-ready`,
      // or when an admin regenerates the password.
      const d = data as EmailTemplateData['pdf-password'];
      const subj = d.reason
        ? 'Your report password has been updated'
        : 'Your report password';
      const reasonHtml = d.reason
        ? `<p style="color:#555">Reason: ${esc(d.reason)}</p>`
        : '';
      const reasonText = d.reason ? `Reason: ${d.reason}\n` : '';
      return {
        subject: subj,
        html: `<p>Hi ${esc(d.fullName)},</p><p>Use this password to open the encrypted PDF for request <code>${esc(d.requestId)}</code>:</p><p style="font-family:monospace;font-size:16px;background:#f6f6f6;padding:10px;border-radius:4px"><strong>${esc(d.pdfPassword)}</strong></p>${reasonHtml}<p style="color:#a00"><strong>Do not share this password.</strong> If you didn't expect it, contact your account manager.</p>`,
        text: `Hi ${d.fullName},\n\nUse this password to open the encrypted PDF for request ${d.requestId}:\n\n  ${d.pdfPassword}\n\n${reasonText}Do not share this password.`,
      };
    }
    case 'contact-received': {
      const d = data as EmailTemplateData['contact-received'];
      return {
        subject: `[Contact] ${d.name}${d.companyName ? ` (${d.companyName})` : ''}`,
        html: `<p><strong>From:</strong> ${esc(d.name)} &lt;${esc(d.email)}&gt;${d.companyName ? ` — ${esc(d.companyName)}` : ''}</p><p>${esc(d.message).replace(/\n/g, '<br/>')}</p>`,
        text: `From: ${d.name} <${d.email}>${d.companyName ? ` (${d.companyName})` : ''}\n\n${d.message}`,
      };
    }
    default: {
      const _exh: never = template;
      throw new Error(`Unknown template: ${String(_exh)}`);
    }
  }
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
