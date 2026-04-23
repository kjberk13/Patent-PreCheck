# PRIVACY_TERMS.md — Patent PreCheck Privacy Policy & Terms of Use Framework

**Scope:** What the live policies must reflect. Authoritative for `/privacy.html` and `/terms.html` updates during Phase 2.7.
**Parent:** `PROJECT_STATE.md` (index)

---

**Status:** Current `/privacy.html` and `/terms.html` exist on the live site but have NOT been audited against locked technical decisions. Full policy audit deferred to Phase 2.7 when Interactive Code Review ships (new data collection forces a review).

**This file captures what the policies MUST reflect. Update the HTML to match during Phase 2.7.**

---

## Data We Collect

### Free tier (`/analyze.html`)
- User-pasted code/text/invention description — **NOT stored persistently**, processed in memory only for the duration of the analysis request
- Request metadata: IP address, user-agent, timestamp (for rate limiting and abuse prevention only)
- Analysis outputs: scores, pillar breakdowns, prior art matches, Report ID — **stored anonymously** (no link to user identity since no signup required)
- Aggregated risk profile for engine tuning: score ranges, technology domains, §101 risk indicators — anonymized, no PII

### Paid tier (Interactive Code Review — planned Phase 2.7)
- Signup PII (required): first name, last name, email, phone, formal mailing address, business address
- Hash of user's code/input (SHA-256 or similar) — used for re-review eligibility and deduplication, **NOT** the raw code
- Session state during 30-day window: score history, refinement edits, opportunity resolutions
- Evidence upload metadata: filename, upload timestamp, user-claimed document date, user-written description, category designation, Claude-extracted structured evidence (summary, supporting-or-not judgment, text excerpts relevant to the category)
- Payment metadata: Stripe session ID, transaction ID, amount, date — **not** card numbers (Stripe holds those)
- Email delivery metadata: delivery status, bounces

---

## Data We DO NOT Collect or Store

- Raw source code uploaded or pasted by users (free or paid tier) — processed in memory only
- **Original evidence documents uploaded during Interactive Code Review — we NEVER store copies.** Files are read once by Claude for evidence extraction, then discarded. Users retain their own originals.
- Raw text of user inventions or descriptions beyond session lifetime
- Credit card numbers (handled by Stripe under their PCI compliance)
- Biometric data
- Third-party social accounts (no social login)
- Data from outside the user's direct submissions (no web scraping of user profiles)

---

## Third Parties We Share Data With

### Operational (required for service)
- **Anthropic** — receives anonymized summaries of user invention text for analysis (LLM calls). Governed by Anthropic's enterprise terms.
- **Voyage AI** — receives anonymized summaries for embedding generation. Governed by Voyage's API terms.
- **Neon** (database) — stores prior art corpus and anonymized analysis outputs. Does not receive raw user code.
- **Netlify** (hosting) — serves the site and Lambda functions. Has standard server logs.
- **Railway** (backend) — runs ingestion workers. Does not touch user submissions.

### Future / Phase 2.7+
- **Stripe** — payment processing (when paid tier launches). Holds card data; we don't.
- **Resend** — transactional email delivery (Interactive Code Review PDF delivery, receipts)

### We do not:
- Sell user data to third parties
- Share user data with advertisers
- Use user submissions to train any AI model (ours or anyone else's)

---

## Retention Policy

| Data Type | Retention | Reason |
|---|---|---|
| Free tier raw submissions | Session only (~60 sec) | Processing; never stored |
| Free tier analysis metadata (anonymized) | Indefinite | Engine tuning, aggregated statistics |
| Paid tier signup PII | Account lifetime + 7 years | Legal/tax/invoicing retention |
| Paid tier session state | 30 days (the interactive review window) + 90 days for audit | User may need to return; audit trail |
| Paid tier input hashes | Account lifetime | Re-review eligibility checks |
| Payment records | 7 years | Tax and legal compliance |
| Email delivery logs | 90 days | Troubleshooting bounces and delivery issues |

---

## User Rights (GDPR-Adjacent Principles)

Regardless of jurisdiction, Patent PreCheck respects the following user rights:
- **Access:** Users can request a copy of all data associated with them
- **Correction:** Users can request correction of inaccurate data
- **Deletion:** Users can request full data deletion (with exceptions for legally required retention like payment records)
- **Portability:** Users can export their data in a machine-readable format (for paid tier reports specifically)
- **Opt-out:** Users can opt out of marketing emails (transactional emails for active reviews cannot be opted out of)

**Implementation:** email hello@patentprecheck.com to exercise any of these rights. Response within 30 days.

---

## Legal Disclaimers (LOCKED Language)

These exact or substantially similar phrases must appear in Terms of Use and relevant UI surfaces:

### Not legal advice
> "Patent PreCheck is an informational and educational tool. It is not legal advice and does not constitute an attorney-client relationship. Results and guidance provided by Patent PreCheck do not guarantee any particular outcome from the United States Patent and Trademark Office (USPTO) or any other patent authority. For legal advice specific to your situation, consult a licensed patent attorney."

### Not a guarantee
> "Patent PreCheck scores and analyses are based on publicly available data and AI-assisted pattern matching. They are not predictive of examiner decisions and should not be relied upon as the sole basis for filing or not filing a patent application. Actual USPTO examination may reach different conclusions."

### Not an attorney
> "Patent PreCheck and its operators are not attorneys. We do not provide legal services. The tool is designed to help you prepare for a conversation with a qualified patent attorney, not to replace one."

---

## User Obligations (Locked)

Users agree to:
- Be 18 years of age or older, or have verifiable parental/guardian consent
- Submit only content they have the legal right to submit (not stolen IP, not classified material, not content violating NDAs)
- Not use the service to file fraudulent patent applications or engage in patent abuse
- Not attempt to reverse-engineer the engine, scrape the platform, or circumvent access controls
- Not share paid-tier access with unauthorized users
- Not submit malicious content (malware, offensive material, illegal content)

---

## Our Obligations (Locked)

Patent PreCheck commits to:
- Reasonable service availability (free tier: best-effort; paid tier: 99% uptime target, no formal SLA in MVP phase)
- Notice of material privacy policy changes at least 30 days before taking effect
- Refund policy for Interactive Code Review ($69.95): full refund if requested within 24 hours of purchase OR if technical issues prevent service delivery; no refund after substantial use of the review window
- Honest representation of features and limitations

---

## IP Ownership (Locked)

- **User retains all rights** to their invention, code, and submitted content
- **Patent PreCheck retains rights** to: the engine, the platform, the design, the trademark, the aggregated anonymized analysis data
- **Fair use of public patent data:** we ingest public USPTO, arXiv, and GitHub data under each source's respective terms of service
- **No IP transfer:** using Patent PreCheck does not transfer any rights from the user to the service, and vice versa

---

## Dispute Resolution (Locked)

- **Jurisdiction:** Laws of the State of Arizona, United States
- **Venue:** Maricopa County, Arizona (Kevin is based in Scottsdale)
- **Arbitration:** Disputes subject to binding arbitration under AAA commercial rules, except:
  - Small-claims court cases (user's option)
  - IP infringement claims
  - Injunctive relief
- **Class action waiver:** Users agree to individual arbitration only; no class actions
- **Governing law:** Arizona state law

---

## Termination

### By user
- Free tier: no account to terminate; stop using the service
- Paid tier: email hello@patentprecheck.com to delete account; deletion within 30 days; refund per Our Obligations above

### By Patent PreCheck
- For TOS violations: immediate termination, no refund
- For service discontinuation: 90-day notice, refunds for unused paid-tier time
- Users retain their data export rights for 30 days after termination

---

## Current Policy Status

**Action required before Interactive Code Review launches (Phase 2.7):**
1. Update `/privacy.html` to reflect all "Data We Collect," "Do NOT Collect," "Third Parties," "Retention," and "User Rights" content above
2. Update `/terms.html` to reflect all "Legal Disclaimers," "User Obligations," "Our Obligations," "IP Ownership," "Dispute Resolution," and "Termination" content above
3. Add "Last updated" date at top of each policy
4. Ensure all locked disclaimer language is present verbatim or substantially similar
5. Review for consistency with actual code behavior (what's collected, retained, shared)

**Implementation note:** Claude Code handles the HTML updates during Phase 2.7 based on this file as the authoritative spec.

---

*End of PRIVACY_TERMS.md. See PROJECT_STATE.md for the index.*
