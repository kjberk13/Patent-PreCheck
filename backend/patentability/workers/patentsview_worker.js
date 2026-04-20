'use strict';

// =====================================================================
// USPTO Open Data Portal worker — Tier A
//
// BACKGROUND
//   • The legacy PatentsView API was retired 2025-05-01 (returns HTTP
//     410 Gone). USPTO migrated the service to the Open Data Portal
//     at data.uspto.gov on 2026-03-20. All patentsview.org URLs now
//     redirect to data.uspto.gov.
//   • This worker keeps source_id 'uspto-patentsview' for registry
//     stability (avoids needing to migrate any row already written
//     under that id). The external-facing service is USPTO ODP.
//
// AUTH (from ODP docs, Getting Started → Authentication)
//   • Header: `X-Api-Key: <key>` on every request.
//   • Key obtained at data.uspto.gov → Developer Portal → Register.
//   • Free tier: 45 requests per minute (≈ 0.75 rps).
//   • Key does not currently expire.
//
// IMPLEMENTATION STATUS — READ BEFORE EDITING
//   The default endpoint path and request/response schema below are
//   BEST-EFFORT GUESSES at the Patent File Wrapper search API. They
//   have not been verified against live ODP responses. The worker is
//   deliberately defensive so it can be adapted via config without a
//   code change when the real schema is observed:
//
//     USPTO_ODP_ENDPOINT       override the POST URL entirely
//     PATENTSVIEW_ENDPOINT     backward-compat alias for USPTO_ODP_ENDPOINT
//
//   parseDocument() also tries multiple plausible field names so
//   close-but-not-exact schema differences parse successfully.
//
// Rate limit: 0.7 rps (slightly under 0.75 to stay clear of the cap).
// Cursor shape: { offset: <nonNegative integer> }
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const {
  DocumentValidationError,
  SourceApiAuthError,
  SourceApiPermanentError,
} = require('../../shared/worker_errors.js');

const SOURCE_ID = 'uspto-patentsview';

// Best-effort default — likely the Patent File Wrapper search endpoint.
// Override via USPTO_ODP_ENDPOINT in the environment if this is wrong.
const DEFAULT_ODP_ENDPOINT = 'https://api.uspto.gov/api/v1/patent/applications/search';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CPC_GROUPS = ['G06F', 'G06N', 'G06Q', 'H04L'];
const DEFAULT_BACKFILL_FROM = '2015-01-01';

// 45 req/min = 0.75 rps. Use 0.7 for safety.
const DEFAULT_RPS = 0.7;

class PatentsViewWorker extends BaseWorker {
  constructor(opts = {}) {
    super({ requestsPerSecond: DEFAULT_RPS, ...opts });
    this.source_id = SOURCE_ID;
    this.tier = 'A';
    this.authEnvVar = 'USPTO_API_KEY';
    this.endpoint =
      opts.endpoint ||
      process.env.USPTO_ODP_ENDPOINT ||
      process.env.PATENTSVIEW_ENDPOINT ||
      DEFAULT_ODP_ENDPOINT;
    this.apiKey = opts.apiKey ?? process.env.USPTO_API_KEY ?? null;
    this.pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
    this.cpcGroups = opts.cpcGroups || DEFAULT_CPC_GROUPS;
    this.backfillFrom = opts.backfillFrom || DEFAULT_BACKFILL_FROM;
    this.deltaLookbackDays = opts.deltaLookbackDays || 7;
  }

  async *pages({ mode, cursor }) {
    if (!this.apiKey) {
      throw new SourceApiAuthError(
        this.source_id,
        this.authEnvVar,
        'register at data.uspto.gov (Developer Portal) to obtain an API key, then set USPTO_API_KEY in the worker host env',
      );
    }

    let offset = (cursor && cursor.offset) || 0;

    while (true) {
      const body = this._buildQuery(mode, offset);

      let res;
      try {
        res = await this.fetchPage(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // 410 means USPTO retired even the ODP path we're on. Tell the
        // operator how to override without a code change.
        if (err instanceof SourceApiPermanentError && err.status === 410) {
          const bodyTail = err.body ? ` — body: ${err.body}` : '';
          throw new SourceApiPermanentError(
            `${this.source_id} endpoint returned HTTP 410 Gone (${this.endpoint})${bodyTail}. ` +
              'USPTO may have moved or retired this ODP endpoint again. Check data.uspto.gov ' +
              '→ Developer Portal for the current URL and set USPTO_ODP_ENDPOINT to override.',
            { status: 410, body: err.body, source: this.source_id },
          );
        }
        throw err;
      }

      const payload = await res.json();
      const items = unwrapItems(payload);

      if (items.length === 0) return;

      offset += items.length;
      yield { docs: items, nextCursor: { offset } };

      if (items.length < this.pageSize) return;
    }
  }

  // Defensive parser. Tries multiple plausible field names so
  // close-but-not-exact schema differences still parse. If all
  // attempts fail, throws DocumentValidationError which the base
  // class counts toward the skip-rate guardrail.
  parseDocument(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new DocumentValidationError('non-object ODP response item', {
        nativeId: null,
        field: 'root',
      });
    }

    const nativeId = firstNonEmpty(
      raw.applicationNumber,
      raw.publicationNumber,
      raw.patentNumber,
      raw.patent_id,
      raw.applicationNumberText,
      raw.documentNumber,
    );
    if (!nativeId) {
      throw new DocumentValidationError('missing application/patent id', {
        nativeId: null,
        field: 'applicationNumber/publicationNumber/patentNumber',
      });
    }

    const title = stringify(
      firstNonEmpty(
        raw.inventionTitle,
        raw.patent_title,
        raw.title,
        raw.inventionSubjectMatterCategory?.inventionTitle,
      ),
    );
    if (!title) {
      throw new DocumentValidationError('missing invention title', {
        nativeId,
        field: 'inventionTitle/patent_title/title',
      });
    }

    const abstract = stringify(
      firstNonEmpty(raw.abstract, raw.abstractText, raw.patent_abstract, raw.description),
    );

    const publishedAt = stringify(
      firstNonEmpty(
        raw.filingDate,
        raw.publicationDate,
        raw.patentDate,
        raw.patent_date,
        raw.earliestPublicationDate,
      ),
    );

    const cpcClassifications = firstNonEmpty(
      raw.cpcClassifications,
      raw.cpcClassificationBag,
      raw.cpc_current,
    );
    const assignees = firstNonEmpty(
      raw.applicants,
      raw.assignees,
      raw.applicantBag,
      raw.assigneeBag,
    );

    const embedText = `${title}\n\n${abstract}`.trim();
    if (embedText.length === 0) {
      throw new DocumentValidationError('empty embedText', { nativeId, field: 'embedText' });
    }

    return {
      native_id: String(nativeId),
      doc_type: 'patent',
      title,
      abstract,
      url: `https://patents.google.com/patent/US${String(nativeId).replace(/[^0-9A-Za-z]/g, '')}`,
      published_at: publishedAt || null,
      language: 'en',
      metadata: {
        cpc_classifications: cpcClassifications || [],
        applicants: assignees || [],
      },
      embedText,
    };
  }

  _buildQuery(mode, offset) {
    const from =
      mode === 'delta'
        ? isoDateDaysAgo(this.now(), this.deltaLookbackDays)
        : this.backfillFrom;

    // Best-effort request shape — follows common REST search-API
    // conventions. If the ODP expects a different JSON layout, this
    // is the place to adapt (or override the whole worker).
    return {
      filter: {
        filingDateRange: { from, to: todayIso(this.now()) },
        cpcClassifications: this.cpcGroups,
      },
      pagination: {
        offset,
        limit: this.pageSize,
      },
      fields: [
        'applicationNumber',
        'publicationNumber',
        'patentNumber',
        'inventionTitle',
        'abstract',
        'filingDate',
        'publicationDate',
        'cpcClassifications',
        'applicants',
      ],
      sort: [{ field: 'applicationNumber', direction: 'asc' }],
    };
  }
}

// ---------------------------------------------------------------------
// Response unwrap helpers
// ---------------------------------------------------------------------

// ODP payload shape isn't verified. Try the common wrappers; fall back
// to the payload itself if it's already an array.
function unwrapItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload.results,
    payload.items,
    payload.data,
    payload.patents,
    payload.applications,
    payload.documents,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function firstNonEmpty(...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim().length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return v;
  }
  return null;
}

function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(stringify).filter(Boolean).join(' ').trim();
  if (typeof v === 'object') {
    // Common wrapper pattern: { text: "..." } or { value: "..." }.
    if (typeof v.text === 'string') return v.text.trim();
    if (typeof v.value === 'string') return v.value.trim();
  }
  return String(v).trim();
}

function isoDateDaysAgo(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

module.exports = { PatentsViewWorker, SOURCE_ID, DEFAULT_ODP_ENDPOINT };
