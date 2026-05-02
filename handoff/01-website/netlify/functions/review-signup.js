'use strict';

// =====================================================================
// Netlify Function: review-signup
//
// Handles form submission from /review-signup.html. Persists a row in
// code_review_signups, classifies the request as `beta_bypass` or
// `stripe_payment` based on BETA_ACCESS_TOKEN, and returns either:
//   - 200 with { report_id, redirect_url } for beta-bypass requests
//   - 402 with { report_id, payment_required: true } for stripe-pay
//     requests (Stripe wires in Phase 4; for now a "Payment coming
//     soon" client message handles this)
//
// CRITICAL data rule (per FEATURES_STATE.md + PRIVACY_TERMS.md):
//   - We receive `input_hash` (SHA-256, hex) and `input_length` from
//     the client as the analyze-time fingerprint
//   - PR-B: we ALSO receive `paste_input` — the live content the user
//     wants reviewed. Persisted to code_review_signups.paste_input
//     (migration 005). NEVER logged; only its length + SHA-256
//     fingerprint appear in log lines.
//   - input_hash is REQUIRED at signup time. If missing, return 400.
//
// Required body fields:
//   first_name, last_name, email, phone,
//   address_line1, address_city, address_state, address_zip,
//   billing_same_as_address (bool),
//   input_hash (SHA-256 hex, 64 chars), input_length (int),
//   paste_input (string, 20..30000 chars)
//
// Optional body fields:
//   business_name, address_line2, access_token,
//   address_country (defaults 'US')
//
// Conditionally required body fields (when billing_same_as_address is
// false): billing_line1, billing_city, billing_state, billing_zip.
// billing_line2 stays optional (mirrors address_line2). When
// billing_same_as_address is true these are ignored — the Lambda
// copies the corresponding address_* values into the billing_*
// columns at INSERT time so every row has a complete billing
// address (Phase 4 Stripe relies on this invariant). billing_country
// is always 'US' for MVP scope and is never read from the request.
//
// Out of scope here: the actual session-engine flow lives in
// review-session.js. Successful signup gives the client a redirect_url
// the frontend (Commit 3) uses to bootstrap into the Q&A.
// =====================================================================

const crypto = require('node:crypto');

const {
  generateReportId,
  respond,
  CORS_HEADERS,
  checkBypassToken,
  parseJsonBody,
  requireFields,
  buildSqlClient,
  log,
} = require('../../backend/code_review/review_helpers.js');

const { sendAccessLinkEmail } = require('../../backend/code_review/email_sender.js');

// Active review window for the paid Interactive Code Review session.
// Mirrors the 30-day promise in privacy.html / terms.html.
const REVIEW_SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const REQUIRED_BODY_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'address_line1',
  'address_city',
  'address_state',
  'address_zip',
  'input_hash',
  'input_length',
];

// Conservative bound — protects against accidental gigantic submits
// even though the analyze.html paste cap is 30K chars. If a client
// passes a wildly out-of-range value it's almost certainly a mistake.
const MAX_INPUT_LENGTH = 1_000_000;

// PR-B: paste_input bounds. Mirrors the textarea maxlength=30000 and
// the spec's >=20 minimum.
const PASTE_INPUT_MIN_LENGTH = 20;
const PASTE_INPUT_MAX_LENGTH = 30_000;

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

function paste_input_invalid(detail) {
  return respond(400, { error: 'paste_input_invalid', detail });
}

function sha256HexNode(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = parseJsonBody(event.body);
    requireFields(body, REQUIRED_BODY_FIELDS);
  } catch (err) {
    return respond(err.statusCode || 400, {
      error: err.message || 'Invalid body',
      ...(err.missing ? { missing_fields: err.missing } : {}),
    });
  }

  if (!SHA256_HEX_RE.test(String(body.input_hash))) {
    return respond(400, {
      error:
        'input_hash must be a 64-character hex SHA-256 digest. The client computes it before submitting.',
    });
  }

  const inputLength = Number(body.input_length);
  if (!Number.isInteger(inputLength) || inputLength <= 0 || inputLength > MAX_INPUT_LENGTH) {
    return respond(400, {
      error: `input_length must be a positive integer ≤ ${MAX_INPUT_LENGTH}`,
    });
  }

  // PR-B: paste_input is the live invention text, separate from the
  // analyze-time input_hash fingerprint. Validate without ever logging
  // the content; only length + SHA-256 fingerprint appear in logs.
  const pasteInput = body.paste_input;
  if (typeof pasteInput !== 'string') {
    return paste_input_invalid('paste_input must be a string');
  }
  if (pasteInput.length < PASTE_INPUT_MIN_LENGTH) {
    return paste_input_invalid(`paste_input must be at least ${PASTE_INPUT_MIN_LENGTH} characters`);
  }
  if (pasteInput.length > PASTE_INPUT_MAX_LENGTH) {
    return paste_input_invalid(`paste_input must be at most ${PASTE_INPUT_MAX_LENGTH} characters`);
  }
  const pasteInputSha256 = sha256HexNode(pasteInput);
  const pasteInputLength = pasteInput.length;

  // Validate billing fields conditionally on the toggle. If
  // billing_same_as_address is false, the four core billing fields
  // become required. If true, they're ignored.
  const billingSameAsAddress = Boolean(body.billing_same_as_address);
  if (!billingSameAsAddress) {
    try {
      requireFields(body, ['billing_line1', 'billing_city', 'billing_state', 'billing_zip']);
    } catch (err) {
      return respond(err.statusCode || 400, {
        error: 'When billing differs from address, billing fields are required.',
        ...(err.missing ? { missing_fields: err.missing } : {}),
      });
    }
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : '';
  const isBypass = checkBypassToken(accessToken);
  const accessMethod = isBypass ? 'beta_bypass' : 'stripe_payment';

  const reportId = generateReportId();

  const sql = buildSqlClient();
  if (!sql) {
    log('error', { event: 'review_signup_db_unavailable' });
    return respond(500, {
      error: 'Signup service is not currently configured. Please try again shortly.',
    });
  }

  // Identifying metadata for abuse prevention. IP is pulled from the
  // x-forwarded-for header Netlify already sets; user_agent is best-
  // effort.
  const headers = event.headers || {};
  const xff = (headers['x-forwarded-for'] || headers['X-Forwarded-For'] || '').split(',')[0].trim();
  const userAgent = headers['user-agent'] || headers['User-Agent'] || '';

  try {
    await sql(
      `INSERT INTO code_review_signups (
        first_name, last_name, business_name, email, phone,
        address_line1, address_line2, address_city, address_state, address_zip, address_country,
        billing_same_as_address,
        billing_line1, billing_line2, billing_city, billing_state, billing_zip, billing_country,
        access_method, access_token_used,
        input_hash, input_length, report_id,
        session_state,
        created_ip, user_agent,
        paste_input
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12,
        $13, $14, $15, $16, $17, $18,
        $19, $20,
        $21, $22, $23,
        $24,
        $25, $26,
        $27
      )`,
      [
        body.first_name,
        body.last_name,
        body.business_name || null,
        body.email,
        body.phone,
        body.address_line1,
        body.address_line2 || null,
        body.address_city,
        body.address_state,
        body.address_zip,
        body.address_country || 'US',
        billingSameAsAddress,
        billingSameAsAddress ? body.address_line1 : body.billing_line1,
        billingSameAsAddress ? body.address_line2 || null : body.billing_line2 || null,
        billingSameAsAddress ? body.address_city : body.billing_city,
        billingSameAsAddress ? body.address_state : body.billing_state,
        billingSameAsAddress ? body.address_zip : body.billing_zip,
        'US', // billing_country always 'US' for MVP per US-only scope
        accessMethod,
        // Store the literal token value when bypass succeeded so we
        // can audit beta-test usage. For non-bypass requests we record
        // null (storing a wrong attempt would just clutter the audit
        // trail without security benefit).
        isBypass ? accessToken : null,
        body.input_hash,
        inputLength,
        reportId,
        // Session_state starts null; review-session.js#start populates
        // it on first action.
        null,
        xff || null,
        userAgent || null,
        pasteInput,
      ],
    );
  } catch (err) {
    log('error', {
      event: 'review_signup_db_insert_failed',
      error: err.message,
      report_id: reportId,
    });
    return respond(500, {
      error: 'Could not save your signup. Please try again shortly.',
    });
  }

  log('info', {
    event: 'review_signup_created',
    report_id: reportId,
    access_method: accessMethod,
    paste_input_length: pasteInputLength,
    paste_input_sha256: pasteInputSha256,
  });
  if (!isBypass) {
    // Capture the row but return 402 — the client renders a "Payment
    // coming soon" message. When Stripe wires in Phase 4, this branch
    // becomes the redirect to Stripe checkout.
    return respond(402, {
      report_id: reportId,
      payment_required: true,
      message:
        'Stripe payment integration is coming soon. We have your details on file — we will contact you when paid signups open.',
    });
  }

  // Fire-and-forget access-link email — only on bypass success
  // (when the Q&A session is actually live). Email failure must
  // never break the signup response — the user is already on the
  // success page; the email is for re-entry.
  const sessionEndDate = new Date(Date.now() + REVIEW_SESSION_WINDOW_MS).toISOString();
  sendAccessLinkEmail({
    to: body.email,
    firstName: body.first_name,
    reportId,
    sessionEndDate,
  }).catch((err) => {
    log('error', {
      event: 'review_signup_email_failed',
      report_id: reportId,
      error: err && err.message ? err.message : String(err),
    });
  });
  
  // Bypass success — frontend redirects into the Q&A flow.
  return respond(200, {
    report_id: reportId,
    redirect_url: `/review.html?id=${encodeURIComponent(reportId)}`,
    access_method: 'beta_bypass',
  });
};
