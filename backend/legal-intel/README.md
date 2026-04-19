# Patent PreCheck Backend

## Files
- `legal_sources.js` — Daily legal intelligence fetch (30+ sources, 4 tiers)
- `notifier.js` — Slack + Email alert system  
- `stripe_server.js` — Payment processing (Stripe checkout + webhooks)

## Replit Setup (15 minutes)

### 1. Create Repl
- replit.com → New Repl → Node.js
- Upload these 3 files

### 2. Install dependencies (none needed — all built-in Node.js)

### 3. Set Secrets (Replit left sidebar → Secrets)
```
STRIPE_SECRET_KEY        = sk_live_... (from Stripe dashboard)
STRIPE_WEBHOOK_SECRET    = whsec_...  (from Stripe webhook settings)
STRIPE_PRICE_ONE_TIME    = price_...  (create in Stripe dashboard: $59.99)
STRIPE_PRICE_REANALYZE   = price_...  (create in Stripe dashboard: $19.99)
STRIPE_PRICE_PRO_SINGLE  = price_...  ($49.99/mo subscription)
STRIPE_PRICE_PRO_UNLIMITED = price_... ($89.99/mo subscription)
SENDGRID_API_KEY         = SG.xxxxx
SLACK_WEBHOOK            = https://hooks.slack.com/services/...
NOTIFY_EMAIL_TO          = kjberk13@gmail.com
SITE_URL                 = https://patentprecheck.com
```

### 4. Entry point (main.js)
Create main.js:
```js
const { server } = require('./stripe_server');
const { runDailyUpdate } = require('./legal_sources');
const { dispatchNotifications } = require('./notifier');

// Start payment server
console.log('Patent PreCheck backend starting...');

// Run legal update on startup (then daily via cron)
runDailyUpdate().then(({ update, notifications }) => {
  return dispatchNotifications(notifications, update);
}).catch(console.error);
```

### 5. Add Cron (Replit Deployments → Cron)
`0 2 * * *` → `node -e "require('./legal_sources').runDailyUpdate().then(({update,notifications})=>require('./notifier').dispatchNotifications(notifications,update))"`

### 6. Update analyze.html
Change `API_BASE` in analyze.html from:
`https://api.patentprecheck.com`
to your Replit URL:
`https://patent-precheck-backend.yourusername.replit.app`

### 7. Set up Stripe Webhook
- Stripe Dashboard → Developers → Webhooks → Add endpoint
- URL: `https://your-replit-url.replit.app/webhook`
- Events: `checkout.session.completed`, `customer.subscription.deleted`
- Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`

## Stripe Products to Create
In Stripe Dashboard → Products → Add product:

1. **Patent PreCheck — One-Time Analysis**
   - Price: $59.99 one-time
   - Copy price ID → STRIPE_PRICE_ONE_TIME

2. **Patent PreCheck — Re-Analysis**  
   - Price: $19.99 one-time
   - Copy price ID → STRIPE_PRICE_REANALYZE

3. **Patent PreCheck Pro — Single Codebase**
   - Price: $49.99/month recurring
   - Copy price ID → STRIPE_PRICE_PRO_SINGLE

4. **Patent PreCheck Pro — Unlimited**
   - Price: $89.99/month recurring
   - Copy price ID → STRIPE_PRICE_PRO_UNLIMITED
