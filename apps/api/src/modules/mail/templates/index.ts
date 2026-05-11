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
    case 'welcome-signup': {
      const d = data as EmailTemplateData['welcome-signup'];
      const upgradeNote = d.pendingUpgrade && d.pendingPlanName
        ? `<p>You also requested an upgrade to <strong>${esc(d.pendingPlanName)}</strong>. Our team will review it within 1 business day and you'll get a confirmation email once it's active.</p>`
        : '';
      const upgradeNoteText = d.pendingUpgrade && d.pendingPlanName
        ? `\n\nYou also requested an upgrade to ${d.pendingPlanName}. Our team will review it within 1 business day and you'll get a confirmation email once it's active.`
        : '';
      return {
        subject: `Welcome to SecAudit, ${d.fullName.split(' ')[0]}`,
        html: brandWrap(`
          <h1 style="margin:0 0 16px 0;font-size:22px;color:#0b1220">Welcome to SecAudit</h1>
          <p>Hi ${esc(d.fullName)},</p>
          <p>Thanks for signing up. Your account is on the <strong>${esc(d.planName)}</strong> plan.</p>
          ${upgradeNote}
          <p style="margin:24px 0">
            <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open your dashboard</a>
          </p>
          <p style="color:#555;font-size:14px">Need a hand getting your first scan running? Just reply to this email.</p>
        `),
        text: `Welcome to SecAudit, ${d.fullName}.\n\nYour account is on the ${d.planName} plan.${upgradeNoteText}\n\nOpen your dashboard: ${d.dashboardUrl}\n\n— The SecAudit team`,
      };
    }
    case 'pcr-submitted-user': {
      const d = data as EmailTemplateData['pcr-submitted-user'];
      return {
        subject: `We received your upgrade to ${d.toPlanName}`,
        html: brandWrap(`
          <h1 style="margin:0 0 16px 0;font-size:22px;color:#0b1220">Upgrade request received</h1>
          <p>Hi ${esc(d.fullName)},</p>
          <p>We've received your request to move from <strong>${esc(d.fromPlanName)}</strong> to <strong>${esc(d.toPlanName)}</strong> (${esc(d.billingCycle)} billing).</p>
          <p>We'll review it and get back to you within <strong>1 business day</strong>. You'll get a confirmation email once your new plan is active — no action needed from you in the meantime.</p>
          <p style="margin:24px 0">
            <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Back to dashboard</a>
          </p>
        `),
        text: `Hi ${d.fullName},\n\nWe've received your request to upgrade from ${d.fromPlanName} to ${d.toPlanName} (${d.billingCycle} billing).\n\nWe'll review it and get back to you within 1 business day. You'll get a confirmation email once your new plan is active.\n\nDashboard: ${d.dashboardUrl}\n\n— The SecAudit team`,
      };
    }
    case 'pcr-submitted-admin': {
      const d = data as EmailTemplateData['pcr-submitted-admin'];
      return {
        subject: `[PCR] ${d.userEmail} → ${d.toPlanName} (${d.billingCycle})`,
        html: brandWrap(`
          <h1 style="margin:0 0 16px 0;font-size:20px;color:#0b1220">New plan-change request</h1>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#555">User</td><td><strong>${esc(d.userFullName)}</strong> &lt;${esc(d.userEmail)}&gt;</td></tr>
            ${d.companyName ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Company</td><td>${esc(d.companyName)}</td></tr>` : ''}
            <tr><td style="padding:4px 12px 4px 0;color:#555">From</td><td>${esc(d.fromPlanName)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555">To</td><td><strong>${esc(d.toPlanName)}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555">Billing</td><td>${esc(d.billingCycle)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555">PCR ID</td><td><code>${esc(d.pcrId)}</code></td></tr>
          </table>
          <p style="margin:24px 0">
            <a href="${esc(d.adminInboxUrl)}" style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open admin inbox</a>
          </p>
        `),
        text: `New plan-change request\n\nUser: ${d.userFullName} <${d.userEmail}>\n${d.companyName ? `Company: ${d.companyName}\n` : ''}From: ${d.fromPlanName}\nTo: ${d.toPlanName}\nBilling: ${d.billingCycle}\nPCR ID: ${d.pcrId}\n\nOpen admin inbox: ${d.adminInboxUrl}`,
      };
    }
    case 'pcr-approved': {
      const d = data as EmailTemplateData['pcr-approved'];
      const noteHtml = d.notes
        ? `<p style="background:#f6f6f6;padding:12px;border-radius:6px;color:#333"><em>Note from our team:</em> ${esc(d.notes)}</p>`
        : '';
      const noteText = d.notes ? `\n\nNote from our team: ${d.notes}` : '';
      return {
        subject: `Your upgrade to ${d.toPlanName} is active`,
        html: brandWrap(`
          <h1 style="margin:0 0 16px 0;font-size:22px;color:#0b1220">You're on ${esc(d.toPlanName)} 🎉</h1>
          <p>Hi ${esc(d.fullName)},</p>
          <p>Good news — your upgrade to <strong>${esc(d.toPlanName)}</strong> (${esc(d.billingCycle)} billing) is now active. All the new caps and features are unlocked on your account.</p>
          ${noteHtml}
          <p style="margin:24px 0">
            <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open dashboard</a>
          </p>
        `),
        text: `Hi ${d.fullName},\n\nYour upgrade to ${d.toPlanName} (${d.billingCycle} billing) is now active.${noteText}\n\nDashboard: ${d.dashboardUrl}\n\n— The SecAudit team`,
      };
    }
    case 'pcr-rejected': {
      const d = data as EmailTemplateData['pcr-rejected'];
      return {
        subject: `About your upgrade to ${d.toPlanName}`,
        html: brandWrap(`
          <h1 style="margin:0 0 16px 0;font-size:22px;color:#0b1220">We couldn't approve your upgrade</h1>
          <p>Hi ${esc(d.fullName)},</p>
          <p>We weren't able to approve your upgrade to <strong>${esc(d.toPlanName)}</strong> right now.</p>
          <p style="background:#f6f6f6;padding:12px;border-radius:6px;color:#333"><em>Reason:</em> ${esc(d.notes)}</p>
          <p>Your account is unchanged — you're still on your current plan. If you have questions, just reply to this email and our team will help.</p>
          <p style="margin:24px 0">
            <a href="${esc(d.dashboardUrl)}" style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Back to dashboard</a>
          </p>
        `),
        text: `Hi ${d.fullName},\n\nWe weren't able to approve your upgrade to ${d.toPlanName} right now.\n\nReason: ${d.notes}\n\nYour account is unchanged — you're still on your current plan. If you have questions, just reply to this email.\n\nDashboard: ${d.dashboardUrl}\n\n— The SecAudit team`,
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

/**
 * Lightweight, mobile-friendly email shell with SecAudit brand strip.
 * No external CSS, single max-width container, system fonts only.
 */
function brandWrap(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);overflow:hidden">
<tr><td style="background:#0b1220;color:#fff;padding:14px 24px;font-size:15px;font-weight:700;letter-spacing:0.3px">SecAudit — Automated security testing</td></tr>
<tr><td style="padding:24px">${inner}</td></tr>
<tr><td style="padding:14px 24px;background:#f4f6f8;color:#888;font-size:12px;text-align:center">© SecAudit. You're receiving this because you have an account at secaudit.xyz.</td></tr>
</table></td></tr></table></body></html>`;
}
