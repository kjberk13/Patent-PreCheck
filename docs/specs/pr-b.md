# PR-B — Carry code forward from `/analyze.html` to `/review-signup.html`

**Status:** Spec approved 2026-05-01 by Kevin. Ready to implement.
**Branch:** `pr-b-carry-code-forward`
**PR target:** `main` (same workflow as PR #5, PR #6)

## Problem

Users who upgrade from the free tier to the Interactive Code Review currently lose the code they pasted on `/analyze.html` and have nowhere on `/review-signup.html` to provide it again. The free-tier privacy banner today over-promises ("we never store your code") in a way that doesn't reflect the post-upgrade flow.

Fix: carry the code forward in `sessionStorage`, surface it on the signup page as an attached-code pill that's collapsed but always editable, and update the analyze-page copy to honestly scope the privacy promise to the free tier.

## Verified current behavior (production, 2026-05-01)

- `/analyze.html` writes only `{hash, length}` to `sessionStorage["patent-precheck-review-input"]` when `#upgradeToReviewBtn` is clicked, then navigates.
- `/review-signup.html` has no field for the code at all. The form posts to `/.netlify/functions/review-signup` and redirects to `/review.html` on success.
- The privacy banner on `/analyze.html` reads "Your code stays with you. Analyzed this session only. Close the window — it's gone. We never store your code." This is true for users who don't upgrade, misleading for those who do.

## Frontend — `apps/website/analyze.html`

Mirror all edits to `handoff/01-website/analyze.html`.

### 1. Stash full code on upgrade click

Where the `#upgradeToReviewBtn` click handler currently writes `{hash, length}` to sessionStorage, change it to write the full content:

```js
sessionStorage.setItem('patent-precheck-review-input', JSON.stringify({
  content: pasteInput.value,
  length: pasteInput.value.length,
  hash, // existing SHA-256
  ts: Date.now()
}));
```

Keep the hash so review-signup.js can run the existing fingerprint check.

### 2. Update privacy banner copy

Replace the current "Your code stays with you" / "Close the window — it's gone" / "We never store your code" copy with:

> **Your code stays in this browser.** Analyzed this session only. If you upgrade to the Interactive Code Review, your code stays in this browser tab until your review begins, then it's deleted. We never store your code on our servers from the free check.

Also adjust the post-scoring green confirmation banner ("Your code has been deleted. We never store your uploaded code…"). Replace with:

> **Your code stays in this browser.** We never store your uploaded code on our servers. Only your score and project metadata are kept.

## Frontend — `apps/website/review-signup.html`

Mirror all edits to `handoff/01-website/review-signup.html`.

Add a new `<fieldset class="field-group" id="codeAttachmentGroup">` as the **first** fieldset in the form, above First Name.

Structure:

```html
<fieldset class="field-group" id="codeAttachmentGroup">
  <legend>Your invention</legend>

  <button type="button" id="codeAttachmentToggle" class="code-pill"
          aria-expanded="false" aria-controls="codeAttachmentPanel">
    <span class="code-pill-check" id="codeAttachmentCheck">✓</span>
    <span class="code-pill-label" id="codeAttachmentLabel">
      Your code is attached — <span id="codeAttachmentCount">0</span> characters
    </span>
    <span class="code-pill-edit" id="codeAttachmentEdit">View / edit ▾</span>
  </button>

  <div id="codeAttachmentPanel" hidden>
    <p class="field-hint">
      This is the content we'll review. Edit if needed before continuing.
    </p>
    <textarea id="reviewPasteInput" name="paste_input"
              class="field-input paste-textarea"
              rows="14" maxlength="30000" required spellcheck="false"
              placeholder="Paste the code, document, or AI conversation you want reviewed."></textarea>
    <div class="paste-meta">
      <span class="paste-counter" data-for="reviewPasteInput">0 / 30,000</span>
    </div>
    <span class="field-error" data-for="reviewPasteInput"></span>
  </div>
</fieldset>
```

Style to match the existing form. Pill: light background, full-width, left-aligned check, right-aligned chevron. On expand, the pill stays visible at the top of the fieldset and the panel slides open beneath it. Use the existing `.field-input` modifier plus a new `.paste-textarea` for monospace font and min-height.

## Frontend — `apps/website/js/review-signup.js`

### On DOM ready

Read `sessionStorage["patent-precheck-review-input"]`:

- If parsed object has a `content` field with `length >= 1`: prefill `#reviewPasteInput.value`, set `#codeAttachmentCount` to the length, leave the panel collapsed (`hidden` stays on `#codeAttachmentPanel`, `aria-expanded="false"` stays on the toggle). Pill reads "✓ Your code is attached — N characters".
- Otherwise (legacy hash-only stash, or direct landing): expand the panel by default, hide `#codeAttachmentCheck`, change `#codeAttachmentLabel` text to "Paste your invention to start your review", and hide `#codeAttachmentEdit`.

### Toggle behavior

Wire `#codeAttachmentToggle` click to:
- Flip `hidden` on `#codeAttachmentPanel`
- Flip `aria-expanded` on the toggle
- Swap chevron text between ▾ (collapsed) and ▴ (expanded) inside `#codeAttachmentEdit`

### Live counter

`input` listener on `#reviewPasteInput`:
- Update `#codeAttachmentCount` to `value.length`
- Update `.paste-counter[data-for="reviewPasteInput"]` to `${value.length.toLocaleString()} / 30,000`
- Add class `warn` to the counter at `length >= 29500`, remove otherwise

### Validation

Add `reviewPasteInput` to the existing validation pipeline (look for `REQUIRED_FIELDS` or the equivalent registry). Validator: `value.trim().length >= 20`. Error: "Please paste at least 20 characters."

### Submit

In `submitSignup`, ensure the JSON payload includes `paste_input: pasteInput.value`. After a successful response, just before `location.href = response.body.redirect_url`, clear the stash:

```js
sessionStorage.removeItem('patent-precheck-review-input');
```

### Soft hash-mismatch notice

At submit time, if the stashed object had a `hash` and a freshly-computed SHA-256 of `#reviewPasteInput.value` doesn't match it, show an inline non-blocking notice above the submit button:

> Note: this content differs from what you scored on the free check — that's fine, just confirming.

Submit proceeds normally regardless.

## Backend — `netlify/functions/review-signup.js`

Accept `paste_input` in the parsed JSON body.

Validate:
- `typeof paste_input === 'string'`
- `paste_input.length >= 20`
- `paste_input.length <= 30000`

On failure, return `400 {error: 'paste_input_invalid', detail: <which check failed>}`.

Persist `paste_input` to the review session record. Match whatever schema `review-session.js` already reads from — extend the existing session row with a `paste_input` column, or add a sibling row keyed by `session_id`, whichever fits. Do not invent a new store.

**Logging:** never log `paste_input` content. Log only `paste_input_length` and a SHA-256 fingerprint of the content.

## Tests

### `tests/review-signup.test.js` (custom Node runner)

- Valid POST: 200, redirect_url returned, session record contains `paste_input`.
- Missing `paste_input`: 400, `error: 'paste_input_invalid'`.
- 19-char `paste_input`: 400.
- 30,001-char `paste_input`: 400.
- Log redaction: capture log output during a valid POST; assert content does not appear in logs and that `paste_input_length` plus a hash fingerprint do appear.

### Frontend smoke

Add a minimal check that `/review-signup.html` renders `#codeAttachmentGroup` and that the existing form still submits when the new field is filled.

## Mirror sync

After all edits to `apps/website/`, copy the changed files byte-for-byte to `handoff/01-website/`. Verify:

```
diff -r apps/website/ handoff/01-website/
```

returns no differences for the touched files.

## Commit / PR plan

Branch: `pr-b-carry-code-forward`. Commit sequence:

1. `docs: add PR-B spec`
2. `feat(analyze): stash full code content in sessionStorage on upgrade click`
3. `feat(analyze): scope privacy banner copy to free-tier behavior`
4. `feat(review-signup): add collapsible code-attachment pill and editable textarea`
5. `feat(review-signup-lambda): accept and persist paste_input on signup`
6. `test: cover paste_input validation and log redaction on review-signup`
7. `chore: sync apps/website to handoff/01-website mirror`

PR title: `PR-B: Carry code forward from free check to interactive review`. PR body references this spec.

## Smoke test plan (run on production after deploy)

Run against the production URL with the `BETA2026-PPC` beta token. Pass/fail per row.

1. Paste real code on `/analyze.html`, get a free score, click upgrade. On `/review-signup.html`, expect pill: "✓ Your code is attached — N characters" with N matching the paste, panel collapsed.
2. Click the pill — panel expands, textarea contains the original code, both counters match, edits update them live.
3. Submit the form with all fields filled. Expect redirect to `/review.html`. SessionStorage entry cleared.
4. Confirm `/review.html` opens with code attached to the session.
5. Edit the code in the textarea before submitting (add a comment line). Expect the soft hash-mismatch notice. Submit succeeds.
6. Land directly on `/review-signup.html` (no analyze upstream). Expect "Paste your invention to start your review" label, panel expanded by default, textarea empty.
7. Submit with textarea containing only "hi" (2 chars). Expect "Please paste at least 20 characters" error, submit blocked.
8. Verify the updated privacy banner copy renders correctly on `/analyze.html`.

## Out of scope (deferred)

- File upload on the signup page (PR-A2 — evidence)
- Chunked uploads, progress UI
- Evidence attachment metadata
- Server-side encryption-at-rest changes for the new `paste_input` column (use whatever the existing session record uses)
