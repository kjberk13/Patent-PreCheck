'use strict';

// =====================================================================
// Code Review — access-link email sender (Resend)
//
// Single entry point sendAccessLinkEmail({to, firstName, reportId,
// sessionEndDate}) used by the review-signup Lambda after a successful
// INSERT. The Lambda fires this fire-and-forget; failures here must
// never break the user-facing signup response.
//
// Sender domain: until Patent PreCheck has its own configured Resend
// domain, send from Resend's default onboarding@resend.dev. Domain
// configuration is a follow-on task.
// =====================================================================

const { Resend } = require('resend');

const DEFAULT_SITE_URL = 'https://patentprecheck-1776362495343.netlify.app';
const FROM_ADDRESS = 'Patent PreCheck <onboarding@resend.dev>';
const SUBJECT = 'Your Interactive Code Review is ready — Patent PreCheck';

async function sendAccessLinkEmail({ to, firstName, reportId, sessionEndDate }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const siteUrl = process.env.SITE_URL || DEFAULT_SITE_URL;
  const reviewUrl = `${siteUrl}/review.html?id=${encodeURIComponent(reportId)}`;
  const html = renderEmailHtml({ firstName, reviewUrl, sessionEndDate });

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [to],
      subject: SUBJECT,
      html,
    });
    if (result && result.error) {
      return { success: false, error: result.error.message || String(result.error) };
    }
    return { success: true, messageId: result && result.data ? result.data.id : undefined };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

function formatSessionEndDate(sessionEndDate) {
  if (!sessionEndDate) return '';
  const d = sessionEndDate instanceof Date ? sessionEndDate : new Date(sessionEndDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderEmailHtml({ firstName, reviewUrl, sessionEndDate }) {
  const safeFirstName = escapeHtml(firstName || 'there');
  const safeUrl = escapeHtml(reviewUrl);
  const endDateText = formatSessionEndDate(sessionEndDate);
  const windowSentence = endDateText
    ? `Your 30-day review window is open until <strong>${escapeHtml(endDateText)}</strong>. You can save and resume from this email anytime before then.`
    : 'Your 30-day review window is open. You can save and resume from this email anytime before it closes.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your Interactive Code Review is ready</title>
</head>
<body style="margin:0;padding:0;background:#FAFAF7;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A1A16;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF7;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #EBEBEB;overflow:hidden">
        <tr><td style="padding:28px 32px 8px">
          <span style="display:inline-block;background:#0C447C;color:#ffffff;font-weight:700;font-size:13px;letter-spacing:.04em;padding:6px 12px;border-radius:6px">Patent PreCheck</span>
        </td></tr>
        <tr><td style="padding:8px 32px 0">
          <h1 style="margin:16px 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.25;color:#0C2340;font-weight:700">Your Interactive Code Review is ready</h1>
        </td></tr>
        <tr><td style="padding:0 32px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3D3D38">Hi ${safeFirstName},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3D3D38">Thanks for upgrading to Interactive Code Review. Your review session is set up and waiting for you. Click the button below to start answering the interview questions.</p>
        </td></tr>
        <tr><td align="center" style="padding:8px 32px 24px">
          <a href="${safeUrl}" style="display:inline-block;background:#0C2340;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px">Start your review &rarr;</a>
        </td></tr>
        <tr><td style="padding:0 32px">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#3D3D38">${windowSentence} When you finalize, your scores lock and your final document is generated.</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#858580">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#0C447C">${safeUrl}</span></p>
        </td></tr>
        <tr><td style="padding:8px 32px 28px">
          <p style="margin:0 0 4px;font-size:14px;line-height:1.65;color:#3D3D38">— The Patent PreCheck team</p>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#F4F4F0;border-top:1px solid #EBEBEB">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#858580">Patent PreCheck&trade; &middot; <a href="${safeUrl}" style="color:#858580;text-decoration:underline">Manage your review</a> &middot; <a href="#" style="color:#858580;text-decoration:underline">Email preferences</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sendAccessLinkEmail, renderEmailHtml };
