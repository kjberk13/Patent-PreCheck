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

  // ---------- Billing address toggle ----------

  var BILLING_FIELD_IDS = [
    'billingLine1',
    'billingCity',
    'billingState',
    'billingZip',
  ];

  function setBillingFieldsRequired(required) {
    BILLING_FIELD_IDS.forEach(function (id) {
      var input = $(id);
      if (!input) return;
      if (required) {
        input.setAttribute('required', '');
      } else {
        input.removeAttribute('required');
        clearError(id);
      }
    });
  }

  function wireBillingCheckbox() {
    var checkbox = $('billingSame');
    var fieldsWrap = $('billingFields');
    if (!checkbox || !fieldsWrap) return;

    function applyState() {
      var same = checkbox.checked;
      fieldsWrap.hidden = same;
      setBillingFieldsRequired(!same);
    }

    checkbox.addEventListener('change', applyState);
    applyState(); // initial sync (default is checked → hidden + not required)
  }

  // ---------- Per-field validation ----------

  var REQUIRED_FIELDS = [
    { id: 'firstName', label: 'first name' },
    { id: 'lastName', label: 'last name' },
    { id: 'addressLine1', label: 'street address' },
    { id: 'addressCity', label: 'city' },
    { id: 'addressState', label: 'state' },
    { id: 'addressZip', label: 'ZIP code' },
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

  function validateBillingAddressIfShown() {
    var checkbox = $('billingSame');
    if (!checkbox || checkbox.checked) return true; // billing matches address — nothing to check
    var allValid = true;
    [
      { id: 'billingLine1', label: 'billing street address' },
      { id: 'billingCity', label: 'billing city' },
      { id: 'billingState', label: 'billing state' },
      { id: 'billingZip', label: 'billing ZIP code' },
    ].forEach(function (f) {
      if (!validateRequiredText(f.id, f.label)) allValid = false;
    });
    return allValid;
  }

  function validateAll() {
    var allValid = true;
    REQUIRED_FIELDS.forEach(function (f) {
      if (!validateRequiredText(f.id, f.label)) allValid = false;
    });
    if (!validateEmail()) allValid = false;
    if (!validatePhone()) allValid = false;
    if (!validateBillingAddressIfShown()) allValid = false;
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

    form.addEventListener('submit', function (event) {
      if (!validateAll()) {
        event.preventDefault();
        // Focus the first invalid field so keyboard users land there
        var firstInvalid = form.querySelector('.field-input.invalid');
        if (firstInvalid && typeof firstInvalid.focus === 'function') {
          firstInvalid.focus();
        }
      }
      // If valid, let the browser POST to the form's action target.
      // The placeholder endpoint returns 501 Not Implemented; Commit 2
      // replaces the action with the real session-engine endpoint.
    });
  });
})();
