// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Notification System
// Sends Slack and Email alerts when legal changes materially affect the
// AI Patentability Algorithm. Called by legal_sources.js after each daily run.
// ─────────────────────────────────────────────────────────────────────────────

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const ENV = {
  SLACK_WEBHOOK:     process.env.SLACK_WEBHOOK     || null,
  SENDGRID_API_KEY:  process.env.SENDGRID_API_KEY  || null,
  NOTIFY_EMAIL_FROM: process.env.NOTIFY_EMAIL_FROM || 'alerts@patentprecheck.com',
  NOTIFY_EMAIL_TO:   process.env.NOTIFY_EMAIL_TO   || null,  // internal team
  SITE_URL:          process.env.SITE_URL           || 'https://patentprecheck.com',
};

// ── SLACK ─────────────────────────────────────────────────────────────────────
function impactEmoji(impact) {
  return { CRITICAL: '🚨', HIGH: '⚠️', MEDIUM: '📋', LOW: 'ℹ️' }[impact] || '📋';
}

async function sendSlack(notification, overallImpact) {
  if (!ENV.SLACK_WEBHOOK) {
    console.log('   [Slack] No webhook configured — skipping');
    return;
  }

  const emoji = impactEmoji(overallImpact);
  const color = { CRITICAL: '#E53E3E', HIGH: '#DD6B20', MEDIUM: '#0C447C', LOW: '#1D9E75' }[overallImpact] || '#0C447C';

  const topItems = (notification.items || []).slice(0, 5);

  const payload = {
    text: `${emoji} *Patent PreCheck — Legal Intelligence Alert*`,
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${emoji} ${notification.subject}`, emoji: true },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: notification.body.slice(0, 800),
            },
          },
          topItems.length ? {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Triggered by:*\n${topItems.map(i => `• <${i.link || '#'}|${i.title.slice(0,80)}> _(relevance: ${i.relevance})_`).join('\n')}`,
            },
          } : null,
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Priority:* ${notification.priority}` },
              { type: 'mrkdwn', text: `*Audience:* ${notification.audience}` },
              { type: 'mrkdwn', text: `*Type:* ${notification.type}` },
              { type: 'mrkdwn', text: `*Time:* ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })} MST` },
            ],
          },
          notification.cta ? {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: notification.cta, emoji: true },
                url: notification.ctaUrl || ENV.SITE_URL,
                style: 'primary',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'View Legal Dashboard', emoji: false },
                url: `${ENV.SITE_URL}/legal-dashboard`,
              },
            ],
          } : null,
        ].filter(Boolean),
      },
    ],
  };

  return postJSON(ENV.SLACK_WEBHOOK, payload, {});
}

// ── EMAIL (SendGrid) ──────────────────────────────────────────────────────────
async function sendEmail(notification, overallImpact, recipientEmail) {
  if (!ENV.SENDGRID_API_KEY) {
    console.log('   [Email] No SendGrid key configured — skipping');
    return;
  }

  const emoji  = impactEmoji(overallImpact);
  const color  = { CRITICAL: '#E53E3E', HIGH: '#DD6B20', MEDIUM: '#0C447C', LOW: '#1D9E75' }[overallImpact] || '#0C447C';
  const topItems = (notification.items || []).slice(0, 5);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7FF;padding:32px 16px;">
    <tr><td>
      <table width="600" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr><td style="background:#0C2340;padding:28px 36px;">
          <table width="100%">
            <tr>
              <td style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;">Patent PreCheck</td>
              <td align="right" style="font-size:11px;color:rgba(255,255,255,.6);letter-spacing:.1em;text-transform:uppercase;">Legal Intelligence</td>
            </tr>
          </table>
        </td></tr>

        <!-- Impact band -->
        <tr><td style="background:${color};padding:12px 36px;">
          <span style="color:#fff;font-size:13px;font-weight:600;letter-spacing:.06em;">${emoji} ${notification.priority} PRIORITY — ${notification.type.replace(/_/g,' ')}</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 36px;">
          <h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:20px;color:#0C2340;">${notification.subject.replace(emoji+' ','')}</h2>
          <p style="margin:0 0 24px;color:#4A5568;font-size:14px;line-height:1.7;">${notification.body.replace(/\n/g,'<br>')}</p>

          ${topItems.length ? `
          <div style="background:#F4F7FF;border-radius:8px;padding:20px;margin:0 0 24px;">
            <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#0C2340;letter-spacing:.06em;text-transform:uppercase;">Source Articles</p>
            ${topItems.map(i => `
            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #E2E8F4;">
              <a href="${i.link||'#'}" style="color:#0C447C;font-size:13px;font-weight:500;text-decoration:none;">${i.title.slice(0,90)}</a>
              <span style="display:inline-block;margin-left:8px;background:#E6F1FB;color:#0C447C;font-size:10px;padding:2px 7px;border-radius:10px;">relevance: ${i.relevance}</span>
              <br><span style="color:#718096;font-size:11px;">${i.source} · ${i.date ? new Date(i.date).toLocaleDateString() : 'today'}</span>
            </div>`).join('')}
          </div>` : ''}

          ${notification.cta ? `
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#0C2340;border-radius:8px;padding:13px 24px;">
                <a href="${notification.ctaUrl||ENV.SITE_URL}" style="color:#fff;font-size:14px;font-weight:600;text-decoration:none;">${notification.cta}</a>
              </td>
              <td width="12"></td>
              <td style="border:1px solid #E2E8F4;border-radius:8px;padding:12px 20px;">
                <a href="${ENV.SITE_URL}/legal-dashboard" style="color:#0C447C;font-size:13px;text-decoration:none;">View Dashboard →</a>
              </td>
            </tr>
          </table>` : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 36px;border-top:1px solid #F0F0EE;background:#FAFAF7;">
          <p style="margin:0;font-size:11px;color:#A0AEC0;line-height:1.6;">
            You're receiving this because you have a Patent PreCheck account. 
            Our AI Patentability Algorithm monitors 30+ sources daily including IPWatchdog, Federal Circuit opinions, 
            Patently-O, Squire Patton Boggs, USPTO Federal Register, and premium services.
            <br><a href="${ENV.SITE_URL}/unsubscribe" style="color:#718096;">Unsubscribe</a> · 
            <a href="${ENV.SITE_URL}/legal-dashboard" style="color:#718096;">Legal Dashboard</a> · 
            <a href="${ENV.SITE_URL}/privacy" style="color:#718096;">Privacy Policy</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const payload = {
    personalizations: [{ to: [{ email: recipientEmail }] }],
    from:    { email: ENV.NOTIFY_EMAIL_FROM, name: 'Patent PreCheck Legal Intelligence' },
    subject: notification.subject,
    content: [
      { type: 'text/plain', value: notification.body },
      { type: 'text/html',  value: html },
    ],
  };

  return postJSON('https://api.sendgrid.com/v3/mail/send', payload, {
    Authorization: `Bearer ${ENV.SENDGRID_API_KEY}`,
  });
}

// ── HTTP POST helper ──────────────────────────────────────────────────────────
function postJSON(url, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
    };
    const client = url.startsWith('https') ? https : http;
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0,200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── DAILY DIGEST for internal team ───────────────────────────────────────────
async function sendDailyDigest(update, notifications) {
  if (!ENV.NOTIFY_EMAIL_TO && !ENV.SLACK_WEBHOOK) return;

  const date     = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const topItems = (update.topItems || []).slice(0, 10);
  const notifSummary = notifications.length
    ? `${notifications.length} user notification(s) queued — ${notifications.map(n=>n.type).join(', ')}`
    : 'No material changes requiring user notifications';

  const digestNotif = {
    type:     'DAILY_DIGEST',
    priority: update.overallImpact,
    subject:  `📋 Patent PreCheck Legal Digest — ${date}`,
    audience: 'internal_team',
    body: `Daily legal intelligence summary:\n\n` +
      `Sources queried: ${update.sourcesQueried}\n` +
      `Relevant items: ${update.itemsFound}\n` +
      `Overall impact: ${update.overallImpact}\n` +
      `User notifications: ${notifSummary}\n\n` +
      `Top items:\n${topItems.map(i => `[${i.relevance}] ${i.title.slice(0,80)} (${i.source})`).join('\n')}`,
    items: topItems,
    cta:    null,
    ctaUrl: null,
  };

  if (ENV.SLACK_WEBHOOK) {
    try {
      await sendSlack(digestNotif, update.overallImpact);
      console.log('   [Slack] Daily digest sent ✓');
    } catch (e) {
      console.log(`   [Slack] Error: ${e.message}`);
    }
  }

  if (ENV.SENDGRID_API_KEY && ENV.NOTIFY_EMAIL_TO) {
    try {
      await sendEmail(digestNotif, update.overallImpact, ENV.NOTIFY_EMAIL_TO);
      console.log(`   [Email] Daily digest → ${ENV.NOTIFY_EMAIL_TO} ✓`);
    } catch (e) {
      console.log(`   [Email] Error: ${e.message}`);
    }
  }
}

// ── SEND ALL PENDING NOTIFICATIONS ───────────────────────────────────────────
async function dispatchNotifications(notifications, update) {
  console.log(`\n📬 Dispatching ${notifications.length} notification(s)...`);

  // Internal digest always goes out
  await sendDailyDigest(update, notifications);

  // User-facing notifications (would loop over user DB in production)
  for (const notif of notifications) {
    console.log(`   → ${notif.type} (${notif.priority}) to ${notif.audience}`);

    if (ENV.SLACK_WEBHOOK && notif.priority === 'CRITICAL') {
      try {
        await sendSlack(notif, notif.priority);
        console.log(`     [Slack] ✓`);
      } catch (e) {
        console.log(`     [Slack] Error: ${e.message}`);
      }
    }
    // In production: query user DB for audience, loop sendEmail() per user
    // For now, send critical alerts to the team address
    if (ENV.SENDGRID_API_KEY && ENV.NOTIFY_EMAIL_TO && notif.priority === 'CRITICAL') {
      try {
        await sendEmail(notif, notif.priority, ENV.NOTIFY_EMAIL_TO);
        console.log(`     [Email] ✓`);
      } catch (e) {
        console.log(`     [Email] Error: ${e.message}`);
      }
    }
  }
}

module.exports = { sendSlack, sendEmail, sendDailyDigest, dispatchNotifications };
