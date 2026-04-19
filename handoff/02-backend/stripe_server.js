// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Stripe Payment Server
// Handles one-time analyses ($59.99), re-analysis ($19.99), and Pro subscriptions
// Deploy on Replit alongside legal_sources.js
// ─────────────────────────────────────────────────────────────────────────────

const https   = require('https');
const http    = require('http');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const ENV = {
  STRIPE_SECRET_KEY:   process.env.STRIPE_SECRET_KEY   || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  SENDGRID_API_KEY:    process.env.SENDGRID_API_KEY    || '',
  SITE_URL:            process.env.SITE_URL            || 'https://patentprecheck.com',
  PORT:                process.env.PORT                || 3000,
};

// ── Stripe Product / Price IDs (set these after creating in Stripe dashboard) ──
const PRICES = {
  ONE_TIME:      process.env.STRIPE_PRICE_ONE_TIME      || 'price_one_time_5999',     // $59.99
  REANALYZE:     process.env.STRIPE_PRICE_REANALYZE     || 'price_reanalyze_1999',    // $19.99
  PRO_SINGLE:    process.env.STRIPE_PRICE_PRO_SINGLE    || 'price_pro_single_4999',   // $49.99/mo
  PRO_UNLIMITED: process.env.STRIPE_PRICE_PRO_UNLIMITED || 'price_pro_unlimited_8999',// $89.99/mo
};

// ── Stripe API helper ─────────────────────────────────────────────────────────
function stripePost(endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const opts = {
      hostname: 'api.stripe.com',
      path: `/v1/${endpoint}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Stripe-Version': '2023-10-16',
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Create Checkout Session ───────────────────────────────────────────────────
async function createCheckoutSession(priceId, mode, customerEmail, metadata = {}) {
  const params = {
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode,
    success_url: `${ENV.SITE_URL}/analyze.html?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url:  `${ENV.SITE_URL}/analyze.html?status=cancelled`,
    'payment_method_types[0]': 'card',
    'allow_promotion_codes': 'true',
  };
  if (customerEmail) params.customer_email = customerEmail;
  Object.entries(metadata).forEach(([k, v]) => {
    params[`metadata[${k}]`] = v;
  });
  if (mode === 'subscription') {
    params['subscription_data[trial_period_days]'] = '0';
  }
  return stripePost('checkout/sessions', params);
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ENV.SITE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Simple router ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${ENV.PORT}`);

  // ── POST /checkout ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/checkout') {
    let body = '';
    req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));

    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }

    const { product, email, fileHash } = payload;

    const products = {
      'one_time':      { priceId: PRICES.ONE_TIME,      mode: 'payment'      },
      'reanalyze':     { priceId: PRICES.REANALYZE,     mode: 'payment'      },
      'pro_single':    { priceId: PRICES.PRO_SINGLE,    mode: 'subscription' },
      'pro_unlimited': { priceId: PRICES.PRO_UNLIMITED, mode: 'subscription' },
    };

    const prod = products[product];
    if (!prod) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `Unknown product: ${product}` }));
      return;
    }

    try {
      const { status, data } = await createCheckoutSession(
        prod.priceId, prod.mode, email,
        { product, fileHash: fileHash || '', source: 'patentprecheck' }
      );
      if (status === 200 && data.url) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: data.url, sessionId: data.id }));
      } else {
        res.writeHead(500);
        res.end(JSON.stringify({ error: data.error?.message || 'Stripe error' }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /webhook ───────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    await new Promise(r => req.on('end', r));
    const rawBody = Buffer.concat(chunks);
    const sig = req.headers['stripe-signature'];

    // Verify webhook signature
    let event;
    try {
      const parts = sig.split(',').reduce((acc, p) => {
        const [k, v] = p.split('=');
        acc[k] = v; return acc;
      }, {});
      const signedPayload = `${parts.t}.${rawBody}`;
      const hmac = crypto.createHmac('sha256', ENV.STRIPE_WEBHOOK_SECRET)
                         .update(signedPayload).digest('hex');
      if (hmac !== parts.v1) throw new Error('Signature mismatch');
      event = JSON.parse(rawBody.toString());
    } catch (err) {
      console.error('Webhook signature failed:', err.message);
      res.writeHead(400);
      res.end('Signature verification failed');
      return;
    }

    // Handle events
    console.log(`Webhook: ${event.type}`);
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const metadata = session.metadata || {};
        console.log(`Payment complete: ${metadata.product} | ${session.customer_email} | ${session.amount_total / 100}`);
        
        // TODO: 
        // 1. Store analysis unlock token in DB (session.id → unlock)
        // 2. Send confirmation email via SendGrid
        // 3. For subscriptions: provision Pro account
        // 4. For re-analysis: mark as eligible to re-analyze
        
        // Placeholder: log to file
        const logEntry = {
          ts: new Date().toISOString(),
          type: event.type,
          sessionId: session.id,
          product: metadata.product,
          email: session.customer_email,
          amount: session.amount_total,
          fileHash: metadata.fileHash,
        };
        fs.appendFileSync(path.join(__dirname, 'payments.log'), JSON.stringify(logEntry) + '\n');
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        console.log(`Subscription cancelled: ${sub.id}`);
        // TODO: downgrade account, disable live monitoring
        break;
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // ── GET /prices ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/prices') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      one_time:      { amount: 5999,  label: 'One-time analysis',            currency: 'usd' },
      reanalyze:     { amount: 1999,  label: 'Re-analyze (returning users)', currency: 'usd' },
      pro_single:    { amount: 4999,  label: 'Pro — 1 codebase live',        currency: 'usd', interval: 'month' },
      pro_unlimited: { amount: 8999,  label: 'Pro — unlimited codebases',    currency: 'usd', interval: 'month' },
    }));
    return;
  }

  // ── Health check ─────────────────────────────────────────────────────────────
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(ENV.PORT, () => {
  console.log(`\n⚡ Patent PreCheck Payment Server`);
  console.log(`   Port:     ${ENV.PORT}`);
  console.log(`   Prices:   ONE_TIME=${PRICES.ONE_TIME}, REANALYZE=${PRICES.REANALYZE}`);
  console.log(`   Stripe:   ${ENV.STRIPE_SECRET_KEY ? '✓ key set' : '⚠ no key — set STRIPE_SECRET_KEY'}`);
  console.log(`   Webhook:  ${ENV.STRIPE_WEBHOOK_SECRET ? '✓ secret set' : '⚠ no secret — set STRIPE_WEBHOOK_SECRET'}\n`);
});

module.exports = { server };
