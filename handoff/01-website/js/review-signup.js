// review-signup.js — client-side validation + UX behaviors for the
// Interactive Code Review signup form. Phase 2.7 Commit 1.
//
// Behaviors:
//   - Soft phone normalization on blur (US → "(XXX) XXX-XXXX")
//   - "Billing address is the same as my address" checkbox toggles
//     billing-address fields + their required state
//   - Pre-submit validation with inline error messages (no alert())
//     (Business name field is optional and intentionally not validated)
//   - Preserve ?access= URL param when navigating onward from the
//     upgrade CTA (handled on analyze.html; this file owns the form
//     behavior only)
//
// All validation is advisory; the real auth + persistence happens
// server-side in Commit 2.

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // ---------- Helpers ----------

  function $(id) {
    return document.getElementById(id);
  }

  function errorSpan(fieldId) {
    return document.querySelector('.field-error[data-for="' + fieldId + '"]');
  }

  function setError(fieldId, message) {
    var input = $(fieldId);
    var span = errorSpan(fieldId);
    if (input) input.classList.add('invalid');
    if (span) {
      span.textContent = message;
      span.classList.add('visible');
    }
  }

  function clearError(fieldId) {
    var input = $(fieldId);
    var span = errorSpan(fieldId);
    if (input) input.classList.remove('invalid');
    if (span) {
      span.textContent = '';
      span.classList.remove('visible');
    }
  }

  // ---------- Validators ----------

  function isNonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  // Lightweight email check — not RFC-perfect, just catches typos.
  function looksLikeEmail(value) {
    if (!isNonEmpty(value)) return false;
    var trimmed = value.trim();
    if (trimmed.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  // Phone: accept 10-digit US or 11+ digit international. Strips
  // formatting characters before counting digits.
  function looksLikePhone(value) {
    if (!isNonEmpty(value)) return false;
    var digits = value.replace(/\D+/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  // Soft-normalize a 10-digit US phone input to "(XXX) XXX-XXXX"
  // format. Leaves non-US inputs untouched (anything with a leading
  // "+" or more than 10 digits passes through).
  function normalizePhoneOnBlur(input) {
    var raw = input.value.trim();
    if (!raw) return;
    if (raw.charAt(0) === '+') return; // explicit international — leave alone
    var digits = raw.replace(/\D+/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') {
      digits = digits.slice(1); // drop leading US country code
    }
    if (digits.length === 10) {
      input.value =
        '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
    }
  }

  // ---------- Billing address checkbox + live sync ----------
  //
  // UX spec (Bucket 2 Component B):
  //   - Checkbox starts UNCHECKED. Billing fields are always visible
  //     and always required (the `required` attribute is set in HTML).
  //   - When user CHECKS the box: billing fields auto-populate from
  //     the current address fields. Live sync starts — typing into
  //     any address field mirrors the value into its billing twin.
  //   - When user types in a billing field while the box is checked:
  //     the box auto-unchecks (billing now diverges from address).
  //     Sync stops.
  //   - When user UNCHECKS the box manually: billing keeps its values.
  //   - When user RE-CHECKS the box AFTER editing billing: a native
  //     confirm() dialog asks them to confirm overwrite. Yes →
  //     repopulate from address and resume sync. No → checkbox
  //     unchecks immediately, billing keeps the user's edits.

  var ADDRESS_BILLING_PAIRS = [
    ['addressLine1', 'billingLine1'],
    ['addressLine2', 'billingLine2'],
    ['addressCity', 'billingCity'],
    ['addressState', 'billingState'],
    ['addressZip', 'billingZip'],
  ];

  function copyAddressToBilling() {
    ADDRESS_BILLING_PAIRS.forEach(function (pair) {
      var addr = $(pair[0]);
      var bill = $(pair[1]);
      if (addr && bill) {
        bill.value = addr.value;
        // Programmatic .value = ... does NOT fire input events, so the
        // billing-edit detector below won't false-positive on this sync.
        // Clear any leftover validation-error decoration on the billing
        // field — the new value is whatever the address had.
        if (bill.classList.contains('invalid')) clearError(pair[1]);
      }
    });
  }

  function billingDiffersFromAddress() {
    return ADDRESS_BILLING_PAIRS.some(function (pair) {
      var addr = $(pair[0]);
      var bill = $(pair[1]);
      var av = addr ? addr.value || '' : '';
      var bv = bill ? bill.value || '' : '';
      return av !== bv;
    });
  }

  function wireBillingCheckbox() {
    var checkbox = $('billingSame');
    if (!checkbox) return;
    checkbox.addEventListener('change', function () {
      if (!checkbox.checked) {
        // User just unchecked. Billing keeps its current values;
        // sync is naturally inert until they re-check.
        return;
      }
      // User just checked. If billing already mirrors address, sync
      // silently (e.g. first-time check on an empty/clean form). If
      // billing has independent edits, confirm before overwriting.
      if (billingDiffersFromAddress()) {
        var confirmed = window.confirm(
          'You are confirming your billing address is the same as your home address, correct?',
        );
        if (!confirmed) {
          // Setting .checked = false programmatically does NOT fire
          // a change event, so we don't recurse.
          checkbox.checked = false;
          return;
        }
      }
      copyAddressToBilling();
    });
  }

  function wireLiveAddressSync() {
    var checkbox = $('billingSame');
    if (!checkbox) return;
    ADDRESS_BILLING_PAIRS.forEach(function (pair) {
      var addr = $(pair[0]);
      if (!addr) return;
      addr.addEventListener('input', function () {
        if (!checkbox.checked) return;
        var bill = $(pair[1]);
        if (!bill) return;
        bill.value = addr.value;
        if (bill.classList.contains('invalid')) clearError(pair[1]);
      });
    });
  }

  function wireBillingFieldEditDetection() {
    var checkbox = $('billingSame');
    if (!checkbox) return;
    ADDRESS_BILLING_PAIRS.forEach(function (pair) {
      var bill = $(pair[1]);
      if (!bill) return;
      bill.addEventListener('input', function () {
        // If the box is checked AND a real user input event fires on
        // a billing field, the user is diverging — auto-uncheck.
        // Programmatic value writes (the live-sync handler) don't
        // fire input events, so this only triggers on actual typing.
        if (checkbox.checked) checkbox.checked = false;
      });
    });
  }

  // ---------- Per-field validation ----------

  var REQUIRED_FIELDS = [
    { id: 'firstName', label: 'first name' },
    { id: 'lastName', label: 'last name' },
    { id: 'addressLine1', label: 'street address' },
    { id: 'addressCity', label: 'city' },
    { id: 'addressState', label: 'state' },
    { id: 'addressZip', label: 'ZIP code' },
    // Billing fields are now always visible and always required per
    // Bucket 2 Component B. When the "same as address" checkbox is
    // active they auto-populate from address (so validation passes
    // for free); when it's unchecked the user fills them directly.
    { id: 'billingLine1', label: 'billing street address' },
    { id: 'billingCity', label: 'billing city' },
    { id: 'billingState', label: 'billing state' },
    { id: 'billingZip', label: 'billing ZIP code' },
  ];

  function validateRequiredText(fieldId, label) {
    var input = $(fieldId);
    if (!input) return true;
    if (!isNonEmpty(input.value)) {
      setError(fieldId, 'Please enter your ' + label + '.');
      return false;
    }
    clearError(fieldId);
    return true;
  }

  function validateEmail() {
    var input = $('emailAddress');
    if (!input) return true;
    if (!isNonEmpty(input.value)) {
      setError('emailAddress', 'Please enter your email address.');
      return false;
    }
    if (!looksLikeEmail(input.value)) {
      setError('emailAddress', 'That email address doesn’t look right. Double-check for typos.');
      return false;
    }
    clearError('emailAddress');
    return true;
  }

  function validatePhone() {
    var input = $('phoneNumber');
    if (!input) return true;
    if (!isNonEmpty(input.value)) {
      setError('phoneNumber', 'Please enter your phone number.');
      return false;
    }
    if (!looksLikePhone(input.value)) {
      setError(
        'phoneNumber',
        'That phone number doesn’t look quite right. Use a 10-digit US number or international with country code.',
      );
      return false;
    }
    clearError('phoneNumber');
    return true;
  }

  function validateAll() {
    var allValid = true;
    REQUIRED_FIELDS.forEach(function (f) {
      if (!validateRequiredText(f.id, f.label)) allValid = false;
    });
    if (!validateEmail()) allValid = false;
    if (!validatePhone()) allValid = false;
    return allValid;
  }

  // ---------- Wire everything up ----------

  ready(function () {
    var form = $('signupForm');
    if (!form) return;

    // Phone normalizer on blur
    var phone = $('phoneNumber');
    if (phone) {
      phone.addEventListener('blur', function () {
        normalizePhoneOnBlur(phone);
      });
    }

    // Clear errors as the user edits (no nagging mid-typing)
    form.addEventListener('input', function (event) {
      var target = event.target;
      if (target && target.id && target.classList.contains('invalid')) {
        clearError(target.id);
      }
    });

    wireBillingCheckbox();
    wireLiveAddressSync();
    wireBillingFieldEditDetection();

    form.addEventListener('submit', function (event) {
      // Always preventDefault — we POST as JSON via fetch(), not as
      // form-encoded. The Lambda parses JSON.
      event.preventDefault();
      // Nit 1 (Bucket 2 Component C): disable the submit button
      // BEFORE validation so a rapid double-click can't fire two
      // simultaneous submissions while validateAll() runs.
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
  });

  // ---------- Submission flow ----------

  function showBanner(kind, message) {
    var banner = $('signupBanner');
    if (!banner) {
      // Nit 3 (Bucket 2 Component C): the page should always have
      // #signupBanner; if it's missing something is wrong with the
      // markup. Drop a warning so it shows up in the console rather
      // than silently swallowing the message.
      console.warn('signupBanner element not found; banner message dropped:', kind, message);
      return;
    }
    banner.className = 'signup-banner ' + kind;
    banner.textContent = message;
    banner.hidden = false;
  }

  function hideBanner() {
    var banner = $('signupBanner');
    if (!banner) {
      console.warn('signupBanner element not found; cannot hide banner');
      return;
    }
    banner.hidden = true;
    banner.textContent = '';
  }

  function buildSubmissionPayload(form) {
    var data = new FormData(form);
    // FormData uses the form's name= attrs — see review-signup.html for
    // the names. Convert to a plain object for JSON serialization.
    var payload = {};
    data.forEach(function (value, key) {
      payload[key] = value;
    });
    // Coerce the checkbox to a boolean (FormData gives the literal "on"
    // string when checked, omits the field when unchecked).
    payload.billing_same_as_address = form
      .querySelector('input[name="billing_same_as_address"]')
      .checked;

    // Access token from URL ?access= param (analyze.html's upgrade CTA
    // preserves it; users can also paste a beta-access link directly).
    var urlParams = new URLSearchParams(window.location.search);
    var accessToken = urlParams.get('access');
    if (accessToken) payload.access_token = accessToken;

    // Input hash + length come from sessionStorage. Commit 3 wires
    // analyze.html to compute SHA-256 of the user's pasted code/text
    // and stash it under this key before navigating to the upgrade
    // CTA. If absent here, the Lambda will 400 — fail fast is better
    // than half-broken state.
    var stashed = readStashedInput();
    if (stashed) {
      payload.input_hash = stashed.hash;
      payload.input_length = stashed.length;
    }

    return payload;
  }

  function readStashedInput() {
    try {
      var raw = window.sessionStorage.getItem('patent-precheck-review-input');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (typeof parsed.hash !== 'string' || typeof parsed.length !== 'number') return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function submitSignup(form) {
    // Nit 2 (Bucket 2 Component C): build the payload and check
    // input_hash BEFORE flipping the button to "Submitting…". If the
    // hash is missing we want a clear inline error, not a transient
    // "Submitting…" → "error" flicker. The submit listener has
    // already disabled the button (Nit 1); restore it on early
    // return.
    var submitBtn = $('signupSubmit');
    var originalText = submitBtn ? submitBtn.textContent : '';
    hideBanner();

    var payload = buildSubmissionPayload(form);

    if (!payload.input_hash) {
      showBanner(
        'error',
        'Your invention details aren’t on file yet. Run a free analysis on the analyze page first, then click Upgrade to Interactive Code Review to land here with your details attached.',
      );
      restoreButton(submitBtn, originalText);
      return;
    }

    if (submitBtn) {
      submitBtn.textContent = 'Submitting…';
    }

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (response) {
        if (response.status === 200 && response.body && response.body.redirect_url) {
          // Beta-bypass success — stash report_id locally so /review.html
          // can auto-resume even when visited without ?id=…, then
          // navigate into the Q&A flow.
          if (response.body.report_id) {
            try {
              localStorage.setItem('patent-precheck-active-review', response.body.report_id);
            } catch (err) {
              // localStorage can throw in private/incognito modes — non-fatal.
            }
          }
          window.location.href = response.body.redirect_url;
          return;
        }
        if (response.status === 402) {
          // Captured-but-payment-required path. Friendly message; the
          // user's details are saved (Stripe wires in Phase 4).
          showBanner(
            'info',
            (response.body && response.body.message) ||
              'Stripe payment integration is coming soon. We have your details on file.',
          );
          restoreButton(submitBtn, originalText);
          return;
        }
        if (response.status >= 400 && response.body && response.body.error) {
          showBanner('error', response.body.error);
          restoreButton(submitBtn, originalText);
          return;
        }
        showBanner('error', 'Something went wrong. Please try again shortly.');
        restoreButton(submitBtn, originalText);
      })
      .catch(function () {
        showBanner('error', 'Network error. Please check your connection and try again.');
        restoreButton(submitBtn, originalText);
      });
  }

  function restoreButton(btn, originalText) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = originalText || 'Continue to review';
  }
})();
