# Patent PreCheck — Deployment Checklist
Generated: April 15, 2026

## ✅ BUILT & READY
- [x] Website (5 pages): index, analyze, legal-intelligence, privacy, terms
- [x] Logo files: stacked/horizontal PNG + JPG (light & dark)
- [x] Backend: legal_sources.js (30+ sources, daily fetch)
- [x] Backend: notifier.js (Slack + SendGrid email alerts)
- [x] Chrome extension: MV3, all pages, dashboard
- [x] Copyright registration: Case #1-15142210311
- [x] Competitive analysis document

## 🚀 DEPLOY TODAY (Priority Order)

### 1. Deploy patentprecheck.com to Netlify (~5 min)
1. Go to https://app.netlify.com
2. Drag-and-drop the `patentprecheck-site` folder (or zip)
3. Site → Domain settings → Add custom domain → patentprecheck.com
4. Update nameservers at your domain registrar to Netlify's nameservers
5. SSL auto-provisions in ~2 minutes
6. **Required before**: Chrome extension submission, backend API

### 2. Set up Replit backend (~30 min)
1. Go to https://replit.com → New Repl → Node.js
2. Upload `patentprecheck-backend.zip` contents
3. Set environment variables in Secrets:
   ```
   SENDGRID_API_KEY=SG.xxxxx
   SLACK_WEBHOOK=https://hooks.slack.com/services/...
   NOTIFY_EMAIL_TO=kjberk13@gmail.com
   SITE_URL=https://patentprecheck.com
   ```
4. Add cron: `0 2 * * * node legal_sources.js` (2 AM daily)
5. Premium keys when ready:
   ```
   LEXIS_API_KEY=...
   WESTLAW_API_KEY=...
   PATSNAP_API_KEY=...
   CLARIVATE_API_KEY=...
   ```

### 3. Stripe payment integration (~2 hours)
- One-time analysis: $59.99
- Pro — 1 codebase live: $49.99/mo
- Pro — unlimited codebases: $89.99/mo  
- Re-analyze: $19.99
1. Create Stripe account at https://stripe.com
2. Set up Products/Prices in Stripe dashboard
3. Add STRIPE_PUBLIC_KEY and STRIPE_SECRET_KEY to Replit
4. Wire up Payment Links (no-code option) OR use Stripe.js on analyze.html

### 4. Chrome Web Store submission (~1 hour)
**Requires patentprecheck.com to be live first**
1. Pay $5 developer fee at https://chrome.google.com/webstore/developer
2. Upload `patent-precheck-chrome-extension.zip`
3. Fill in store listing:
   - Name: Patent PreCheck
   - Description: Real-time AI patentability tracking for developers
   - Category: Productivity
   - Privacy policy URL: https://patentprecheck.com/privacy.html
4. Submit for review (~3-5 business days)

### 5. File Provisional Patent ($320, USPTO) — TIME SENSITIVE
1. Go to https://www.uspto.gov/patents/basics/types-patent-applications/provisional-application-patent
2. File online via EFS-Web
3. Include: AI Patentability Algorithm description, Chrome extension architecture,
   scoring methodology, the human conception tracking approach
4. Filing date establishes priority — do this before any public launch

### 6. File Trademark 
- "Patent PreCheck Score" 
- "AI Patentability Algorithm"
- File at https://www.uspto.gov/trademarks
- Classes: 42 (Software as a service), 45 (Legal services)
- Cost: ~$250-350 per mark per class

## 💰 PENDING API KEYS
- Lexis+ AI: https://www.lexisnexis.com/en-us/products/lexis-plus-ai.page
- Westlaw Precision: https://legal.thomsonreuters.com/en/products/westlaw
- PatSnap: https://www.patsnap.com/pricing
- Clarivate Derwent: https://clarivate.com/derwent

## 📊 ACCOUNTS TO CREATE
- [ ] Stripe (payments)
- [ ] SendGrid (email alerts) — free tier: 100/day
- [ ] Slack workspace or webhook (internal alerts)
- [ ] Netlify (hosting — free tier works)
- [ ] Replit (backend — $7/mo Hacker plan for always-on)
