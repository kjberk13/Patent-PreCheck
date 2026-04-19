'use strict';

// =====================================================================
// Health-ping cron.
//
// POSTs a canned invention to the deployed analyze endpoint and asserts
// a healthy response. Intended to run every 15 minutes from Railway
// cron. Keeps the Netlify function warm and catches regressions fast.
//
// Behaviour:
//   • No-op and exit 0 if HEALTH_CHECK_URL is unset (local dev / CI).
//   • POSTs a small fixed payload, expects HTTP 200 with
//     patentability_score: number.
//   • Exits 1 on any failure (Railway then surfaces the failed run).
//
// Env:
//   HEALTH_CHECK_URL   e.g. https://patentprecheck.com/.netlify/functions/analyze
//   HEALTH_CHECK_TIMEOUT_MS (optional, default 25000)
// =====================================================================

require('dotenv').config();

const DEFAULT_TIMEOUT_MS = 25_000;
const CANNED_INPUT = {
  code:
    'function generateEmbedding(text){\n' +
    '  // A transformer-based encoder that converts tokens to fixed-dim vectors.\n' +
    '  const tokens = tokenize(text);\n' +
    '  return model.forward(tokens);\n' +
    '}\n',
  filename: 'healthcheck.js',
  tier: 'free',
};

async function main() {
  const url = process.env.HEALTH_CHECK_URL;
  if (!url) {
    log('info', { event: 'health_ping_skipped', reason: 'HEALTH_CHECK_URL not set' });
    return;
  }
  const timeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CANNED_INPUT),
      signal: controller.signal,
    });
  } catch (err) {
    fail(`network error: ${err.message}`, { url });
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const body = await safeReadText(res);
    fail(`HTTP ${res.status}`, { url, latency_ms: latencyMs, body_prefix: body.slice(0, 200) });
  }

  let payload;
  try {
    payload = await res.json();
  } catch (err) {
    fail(`response not JSON: ${err.message}`, { url, latency_ms: latencyMs });
  }

  if (!isHealthyPayload(payload)) {
    fail('response missing required fields', {
      url,
      latency_ms: latencyMs,
      payload_keys: Object.keys(payload || {}),
    });
  }

  log('info', {
    event: 'health_ping_ok',
    url,
    latency_ms: latencyMs,
    patentability_score: payload.patentability_score,
    prior_art_match_count: payload.prior_art_match_count,
  });
}

function isHealthyPayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.gate_passed === false) return true; // legit outcome; not a failure mode
  return (
    typeof p.patentability_score === 'number' &&
    typeof p.filing_readiness_score === 'number' &&
    Number.isInteger(p.prior_art_match_count)
  );
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function log(level, event) {
  const fn = level === 'error' ? console.error : console.log;
  fn(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

function fail(message, details = {}) {
  log('error', { event: 'health_ping_failed', error: message, ...details });
  process.exit(1);
}

main().catch((err) => {
  fail(err.message || String(err));
});
