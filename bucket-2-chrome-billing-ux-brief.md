# Bucket 2 — Chrome consistency + Billing UX + Polish nits

**File:** `bucket-2-chrome-billing-ux-brief.md` (at repo root)
**Branch:** `feat/bucket-2-chrome-billing-ux`
**Base:** `main` (HEAD at branch creation: `36dff81`)

## Background

Phase 2.7 Commit 2 shipped to production on April 26, 2026. Commit 2 was backend-focused — schema, Lambdas, and the signup form's submission logic. During Commit 2 review and smoke testing, we identified four UI/UX issues that don't belong to any specific Phase 2.7 commit but should land before Commit 3 (interactive Q&A frontend). Bucket 2 collects them into one focused PR.

This is **NOT** a Phase 2.7 commit. It's a side PR that lands between Commit 2 and Commit 3.

## Scope

Four components in one PR:

---

## Component A — Chrome consistency

Every HTML page on the site should have the same nav and footer. Currently nav and footer vary across pages (some have full logo, some have simpler version; some have current page links, some have outdated links).

**What to do:**

1. **Audit current state.** Inspect every HTML file in `apps/website/` (and the corresponding mirror in `handoff/01-website/`). Make a list of pages and their current nav/footer state.
2. **Pick the canonical version.** The cleanest current nav is on `analyze.html` and `review-signup.html` (most recently updated, full logo, current links). Use that as the source of truth.
3. **Extend the nav.js pattern.** The codebase already has `nav.js` that's referenced from page HTML. The pattern is: each page has a fallback `<nav>` element in HTML; on page load, `nav.js` replaces it with the canonical nav. Same for footer if not already done.
4. **Normalize every page.** Every HTML page should:
   - Reference `nav.js` via `<script src="nav.js" defer></script>`
   - Have a `<nav>` element in the body (the fallback, before nav.js runs)
   - Have a `<footer>` element (also fallback)
   - The fallback nav/footer should be visually identical to what nav.js would produce, so users don't see a flash of unstyled content
5. **Verify nav.js itself is current.** Whatever `nav.js` generates today is the canonical version. If it's missing any current links (e.g., new pages added since `nav.js` was last touched), update `nav.js`. Same for footer.
6. **Mirror to handoff.** Every change to `apps/website/` files must also be applied to the corresponding `handoff/01-website/` mirror.

**Out of scope for Component A:**

- Adding new pages or removing existing pages
- Changing the visual design of nav/footer (colors, fonts, spacing)
- Mobile responsiveness rework (only fix obvious breakage; don't redesign)
- The `mobile.css` file (only touch if directly related to nav/footer chrome)

---

## Component B — Billing UX upgrade

The signup form's billing address section needs the UX Kevin specified during Commit 2 review.

**Current behavior (after Commit 2):**

- Checkbox "Billing address is the same as my address" starts CHECKED
- When checked: billing fields are hidden
- When unchecked: billing fields appear and become required
- Lambda copies address → billing on submit when checkbox is true (auto-copy logic, already shipped)

**Target behavior:**

- Checkbox "Billing address is the same as my address" starts UNCHECKED
- Billing fields are always visible (never hidden via the `hidden` attribute)
- Billing fields start empty and required
- When user checks the box: billing fields auto-populate from address fields with **live sync** (typing in address fields updates billing fields too while checkbox is checked)
- When user edits billing fields directly while box is checked: checkbox auto-unchecks (billing now != address, so the "same" claim is invalidated)
- When user re-checks the box after editing billing: a confirmation popup appears with text "You are confirming your billing address is the same as your home address, correct?". User clicks Yes → billing fields re-populate from address, live sync resumes. User clicks No → checkbox stays unchecked, billing fields keep their edits.

**What to do:**

1. **HTML changes** to `apps/website/review-signup.html`:
   - Remove the `hidden` attribute from `#billingFields`
   - The `required` attribute on billing inputs should always be present (was conditionally toggled by JS before)
   - The checkbox's `checked` attribute should be REMOVED so it starts unchecked
2. **JS changes** to `apps/website/js/review-signup.js`:
   - Remove the `setBillingFieldsRequired()` function and its callers (no longer needed — fields always required)
   - Replace `wireBillingCheckbox()` with new logic implementing the spec above
   - Add a new `wireLiveAddressSync()` that mirrors address fields → billing fields when checkbox is checked
   - Add a new `wireBillingFieldEditDetection()` that auto-unchecks the box if user types in any billing field while box is checked
   - Add a confirmation modal/dialog for the re-check case. Use a native `confirm()` dialog (simple, accessible, works without extra dependencies). Text: "You are confirming your billing address is the same as your home address, correct?"
3. **No schema or Lambda changes.** Commit 2's auto-copy logic still works correctly with the new UX (when checkbox is checked, billing fields contain address values; when unchecked, billing fields contain user-entered values; either way the Lambda saves them as-is, which is what we want now that fields are always populated).
4. **Tests** — none required for this component. The form behavior is JS-only; no integration tests exist for it. Manual testing during browser smoke test (Commit 3 era) will validate.
5. **Mirror to handoff.**

---

## Component C — Bucket 1 polish nits

Three small robustness fixes in `apps/website/js/review-signup.js`:

**Nit 1 — Disable submit button before validation:**

Currently the `submitSignup()` function disables the button, but only AFTER validation passes. If validation passes and the user clicks Submit twice rapidly before the button disables, you'd get two simultaneous submissions.

Fix: disable the button at the START of the submit handler, re-enable on validation failure or response:

```js
form.addEventListener('submit', function (event) {
  event.preventDefault();
  var submitBtn = $('signupSubmit');
  if (submitBtn) submitBtn.disabled = true;
  if (!validateAll()) {
    if (submitBtn) submitBtn.disabled = false;
    var firstInvalid = form.querySelector('.field-input.invalid');
    if (firstInvalid && typeof firstInvalid.focus === 'function') {
      firstInvalid.focus();
    }
    return;
  }
  submitSignup(form);
});
```

**Nit 2 — Move input_hash check before button-disable:**

Currently in `submitSignup()` the button gets disabled and shows "Submitting…" before we check if `input_hash` is even present. Better UX: check `input_hash` first, show error if missing, then disable button if proceeding.

Fix: reorder so `input_hash` check happens before button state change.

**Nit 3 — Defensive null check for signupBanner:**

Currently `showBanner()` and `hideBanner()` look up `$('signupBanner')` and access properties. If for some reason the element doesn't exist, this would silently no-op. That's actually OK per the current code (early return when null), so this nit is minor. But add a clear early return at the top of each function for readability:

```js
function showBanner(kind, message) {
  var banner = $('signupBanner');
  if (!banner) {
    console.warn('signupBanner element not found; banner message dropped:', kind, message);
    return;
  }
  banner.className = 'signup-banner ' + kind;
  banner.textContent = message;
  banner.hidden = false;
}
```

Same pattern for `hideBanner()`.

**Mirror to handoff.**

---

## Component D — Analyze.html duplicate CTA fix

During Commit 2 smoke testing on April 26, Kevin clicked "Upgrade to full Interactive Code Review — $69.95" (top CTA in dark navy panel) and got "Payment coming soon". Then clicked "Upgrade to Interactive Code Review →" (bottom CTA in separate panel) and was correctly taken to `/review-signup.html`.

Two upgrade CTAs going to different destinations. One is broken (or points to a non-existent endpoint). They should both go to `/review-signup.html`.

**What to do:**

1. Audit `apps/website/analyze.html` for all upgrade CTAs. There may be exactly two as described, or there may be more. Find them all.
2. Pick the canonical destination. All upgrade CTAs should point to `/review-signup.html` (preserving any URL params like `?access=` if present). The "Payment coming soon" CTA was probably an older placeholder pointing at a route that no longer exists; it should be updated, not removed.
3. **Decide: one CTA or two.** Two upgrade CTAs on the same page is itself a UX issue (decision fatigue, redundant). I recommend keeping ONE upgrade CTA, removing the other. Pick the more visible/contextual one (the "Upgrade to full Interactive Code Review — $69.95" panel is more comprehensive — keep that one, remove the simpler bottom CTA).
4. **Verify URL preservation.** When the user has `?access=BETA2026-PPC` in the URL on `analyze.html` and clicks the upgrade CTA, the `access` param must be carried through to `/review-signup.html`. Check the existing JS to confirm this logic (likely already done). If not, add it.
5. Mirror to handoff.

---

## Required tests

**Component-level tests:**

- Component A: No automated tests required. Manual smoke test: visit every HTML page, confirm nav/footer look identical.
- Component B: No automated tests required (form behavior is JS-only). Manual smoke test described in Component B above. The integration test `review-signup.test.js` should still pass without modification — the Lambda doesn't care about form UX.
- Component C: Existing tests (`review-signup.test.js`) should still pass. No new tests required for these polish fixes.
- Component D: No automated tests required. Manual smoke test: click each upgrade CTA on `analyze.html`, confirm it goes to `/review-signup.html`.

**Run before pushing:**

```
npm run test
npm run lint
npm run format:check
```

All three must pass.

---

## What is OUT of scope

- **Schema changes** — none. Commit 2's schema is final.
- **Lambda changes** — none. Commit 2's Lambdas are final.
- **New tests** — none beyond verifying existing tests still pass.
- **Phase 2.7 brief updates** — Bucket 2 is not a Phase 2.7 commit, so the phase brief stays unchanged. Update `OPEN_QUESTIONS.md` if any newly-discovered limitations come up during the work.
- **Commit 3 work** — analyze.html sessionStorage write logic is Commit 3 scope, NOT Bucket 2. If you encounter the missing-input-hash flow during testing, recognize that it's expected (Commit 3 fixes it) and don't touch it here.
- The 401 ownership check, race conditions, evidence boost tests, schema CHECK constraints — all explicitly deferred to future hardening PRs, not Bucket 2.

---

## Files expected to change

Approximate count (will vary based on Component A audit):

- `apps/website/index.html` (chrome only)
- `apps/website/analyze.html` (chrome + Component D)
- `apps/website/review-signup.html` (chrome + Component B)
- `apps/website/attorneys.html` (chrome only)
- `apps/website/filing.html` (chrome only)
- `apps/website/legal-intelligence.html` (chrome only)
- `apps/website/platform.html` (chrome only)
- `apps/website/privacy.html` (chrome only)
- Other HTML pages discovered during audit (chrome only)
- `apps/website/js/review-signup.js` (Component B + Component C)
- `apps/website/nav.js` (Component A)
- `bucket-2-chrome-billing-ux-brief.md` (this brief)
- All corresponding `handoff/01-website/...` mirrors

---

## Workflow

1. Create branch `feat/bucket-2-chrome-billing-ux` from `main`
2. Land this brief at `bucket-2-chrome-billing-ux-brief.md` as the first commit
3. Component A audit + implementation
4. Component B implementation
5. Component C polish fixes
6. Component D fix
7. Run tests + lint + format checks
8. Push, open PR, request review

---

## Done criteria

- All HTML pages have identical nav and footer (visually verified by Kevin)
- Signup form's billing UX matches the spec in Component B (visually verified)
- Frontend shim's polish nits are fixed (code review verified)
- `analyze.html` has consistent upgrade CTAs all pointing to `/review-signup.html` (verified)
- All tests pass
- Lint clean
- Prettier clean
- Handoff mirrors are byte-identical to source where applicable

When ready, push and open a PR. Reply with the PR URL when done.
