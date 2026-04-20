'use strict';

// =====================================================================
// USPTO Open Data Portal worker — Tier A
//
// BACKGROUND
//   • Legacy PatentsView API retired 2025-05-01 (HTTP 410). USPTO
//     migrated the service to the Open Data Portal at data.uspto.gov
//     on 2026-03-20.
//   • This worker keeps source_id 'uspto-patentsview' for registry
//     stability. The external-facing service is USPTO ODP.
//
// AUTH
//   • Header: `X-Api-Key: <key>` on every request.
//   • Key obtained at data.uspto.gov → Developer Portal → Register.
//   • Free tier: 45 requests per minute (≈ 0.75 rps).
//   • Key does not currently expire.
//
// REQUEST SCHEMA (canonical, verified against ODP Swagger)
//   {
//     "q": "<lucene-style query>",
//     "filters":      [{ name, value: [...] }],      // exact-match
//     "rangeFilters": [{ field, valueFrom, valueTo }],
//     "sort":         [{ field, order: 'asc'|'desc' }],
//     "fields":       [<dot-notation paths>],        // optional narrow
//     "pagination":   { offset, limit },
//     "facets":       [<paths>]                      // optional
//   }
//
//   Field paths use dot-notation on the nested response tree, e.g.
//   `applicationMetaData.filingDate`, `applicationMetaData.inventionTitle`.
//
// RESPONSE SHAPE (observed)
//   Each item typically has a top-level `applicationNumberText` and a
//   nested `applicationMetaData` object. parseDocument() reads nested
//   paths but also falls back to top-level names so a schema drift
//   doesn't instantly break ingestion.
//
// OPEN ITEM: abstract field path
//   Kevin flagged that abstract text may not be in the default search
//   response. parseDocument() checks several plausible paths; if none
//   return text, the worker ingests title-only — retrieval quality
//   degrades but ingestion proceeds. Swagger verification needed to
//   confirm whether abstract requires a secondary call to
//   /api/v1/patent/applications/{applicationNumberText}.
//
// Rate limit: 0.7 rps (just under the 45 req/min cap).
// Cursor shape: { offset: <nonNegative integer> }
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const {
  DocumentValidationError,
  SourceApiAuthError,
  SourceApiPermanentError,
} = require('../../shared/worker_errors.js');

const SOURCE_ID = 'uspto-patentsview';

const DEFAULT_ODP_ENDPOINT = 'https://api.uspto.gov/api/v1/patent/applications/search';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CPC_GROUPS = ['G06F', 'G06N', 'G06Q', 'H04L'];
const DEFAULT_BACKFILL_FROM = '2015-01-01';
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
    // Optional override for the primary query string. If unset, the
    // worker builds one from applicationType + CPC groups.
    this.customQuery = opts.customQuery || null;
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
        // USPTO ODP returns HTTP 404 with a "No matching records" body
        // when a valid query matches zero documents. That's a
        // success-with-empty-result, not an API failure. Terminate the
        // page loop cleanly; the base class marks the run `success`
        // with docs_ingested=0.
        if (
          err instanceof SourceApiPermanentError &&
          err.status === 404 &&
          isEmptyResultBody(err.body)
        ) {
          this.logger('info', {
            event: 'uspto_empty_result_set',
            source: this.source_id,
            offset,
            body_preview: truncateForLog(err.body, 160),
          });
          return; // graceful termination
        }
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

  parseDocument(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new DocumentValidationError('non-object ODP response item', {
        nativeId: null,
        field: 'root',
      });
    }

    const meta = raw.applicationMetaData || {};

    // Native ID — ODP canonical is applicationNumberText at the top
    // level. Fall back to other plausible names so a drift doesn't
    // break ingestion.
    const nativeId = firstNonEmpty(
      raw.applicationNumberText,
      raw.applicationNumber,
      raw.publicationNumberText,
      raw.publicationNumber,
      raw.patentNumber,
      raw.patent_id,
    );
    if (!nativeId) {
      throw new DocumentValidationError('missing applicationNumberText / id', {
        nativeId: null,
        field: 'applicationNumberText',
      });
    }

    // Title — under applicationMetaData per ODP schema.
    const title = stringify(
      firstNonEmpty(
        meta.inventionTitle,
        meta.inventionTitleText,
        raw.inventionTitle,
        raw.patent_title,
      ),
    );
    if (!title) {
      throw new DocumentValidationError('missing inventionTitle', {
        nativeId,
        field: 'applicationMetaData.inventionTitle',
      });
    }

    // Abstract — path uncertain. Try everywhere plausible. If none
    // match, embedText falls back to title-only (still indexable, just
    // lower retrieval quality than with abstract).
    const abstract = stringify(
      firstNonEmpty(
        meta.inventionAbstractText,
        meta.abstractText,
        meta.abstract,
        extractFromBag(meta.abstractBag, ['abstractTextBagItem', 'text', 'value']),
        raw.abstract,
        raw.abstractText,
        raw.patent_abstract,
      ),
    );

    const publishedAt = stringify(
      firstNonEmpty(
        meta.filingDate,
        meta.grantDate,
        meta.publicationDate,
        raw.filingDate,
        raw.patent_date,
      ),
    );

    const cpcClassifications = firstNonEmpty(
      meta.cpcClassificationBag,
      meta.cpcClassifications,
      raw.cpcClassifications,
      raw.cpc_current,
    );

    // Applicants (assignees). ODP uses applicantBag; older schemas may
    // have assignees / applicants flat arrays.
    const applicants = firstNonEmpty(
      meta.applicantBag,
      meta.applicants,
      raw.applicants,
      raw.assignees,
    );

    const applicationType = stringify(
      firstNonEmpty(meta.applicationTypeLabelName, meta.applicationType),
    );
    const status = stringify(meta.applicationStatusDescriptionText);

    const embedText = abstract ? `${title}\n\n${abstract}`.trim() : title;
    if (embedText.length === 0) {
      throw new DocumentValidationError('empty embedText', { nativeId, field: 'embedText' });
    }

    return {
      native_id: String(nativeId),
      doc_type: 'patent',
      title,
      abstract: abstract || null,
      url: `https://patents.google.com/patent/US${String(nativeId).replace(/[^0-9A-Za-z]/g, '')}`,
      published_at: publishedAt || null,
      language: 'en',
      metadata: {
        application_type: applicationType || null,
        status: status || null,
        cpc_classifications: cpcClassifications || [],
        applicants: applicants || [],
        had_abstract: Boolean(abstract),
      },
      embedText,
    };
  }

  // Build the ODP search request body per the canonical Swagger shape.
  //
  // The query narrows to Utility applications in a date range, with a
  // Lucene clause for CPC symbol prefixes. CPC symbols are hierarchical
  // (e.g. "G06F 7/00"), so we use wildcard matches under the
  // cpcClassificationBag — an exact-value `filters` entry wouldn't
  // match anything more specific than the top-level group.
  _buildQuery(mode, offset) {
    const from =
      mode === 'delta'
        ? isoDateDaysAgo(this.now(), this.deltaLookbackDays)
        : this.backfillFrom;
    const to = todayIso(this.now());

    const q = this.customQuery || this._buildDefaultQ();

    return {
      q,
      // filters[] is reserved for future exact-match narrowing (e.g.
      // pulling only "Patented Case" status). Keep empty for now so
      // the delta window captures pending applications too.
      filters: [],
      rangeFilters: [
        {
          field: 'applicationMetaData.filingDate',
          valueFrom: from,
          valueTo: to,
        },
      ],
      sort: [
        {
          field: 'applicationMetaData.filingDate',
          order: 'asc',
        },
      ],
      pagination: {
        offset,
        limit: this.pageSize,
      },
      // fields: omitted on purpose. The default ODP response includes
      // more metadata than the narrow list we would otherwise request,
      // which helps while the abstract-field path is still being
      // verified. We can narrow once the schema is pinned.
    };
  }

  _buildDefaultQ() {
    const typeClause = 'applicationMetaData.applicationTypeLabelName:Utility';
    if (!this.cpcGroups || this.cpcGroups.length === 0) {
      return typeClause;
    }
    // Lucene wildcard match on the nested bag path. `G06F*` matches
    // G06F, G06F 7/00, G06F 16/00, etc. Joined with OR so any matching
    // CPC group qualifies the document.
    const cpcClause = this.cpcGroups
      .map((g) => `applicationMetaData.cpcClassificationBag.cpcSymbolText:${g}*`)
      .join(' OR ');
    return `${typeClause} AND (${cpcClause})`;
  }
}

// ---------------------------------------------------------------------
// Response unwrap helpers
// ---------------------------------------------------------------------

function unwrapItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload.patentFileWrapperDataBag,
    payload.patentBag,
    payload.applications,
    payload.results,
    payload.items,
    payload.data,
    payload.patents,
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
    if (typeof v.text === 'string') return v.text.trim();
    if (typeof v.value === 'string') return v.value.trim();
  }
  return String(v).trim();
}

// Extract a text value from USPTO's "bag" pattern: an array whose items
// contain a text field under one of several plausible key names.
function extractFromBag(bag, keys = ['text', 'value']) {
  if (!Array.isArray(bag) || bag.length === 0) return null;
  for (const item of bag) {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      for (const key of keys) {
        if (typeof item[key] === 'string' && item[key].trim().length > 0) {
          return item[key];
        }
      }
      // Nested bag: abstractBag → [{ abstractTextBagItem: [{ text: "..." }] }]
      for (const val of Object.values(item)) {
        if (Array.isArray(val)) {
          const inner = extractFromBag(val, keys);
          if (inner) return inner;
        }
      }
    }
  }
  return null;
}

// USPTO ODP 404-as-empty-result signal. Body looks like:
//   {"code":"404","message":"Not Found","detailedMessage":"No matching records found, ..."}
// We only treat a 404 as empty-result when the body confirms it — a 404
// without this signal (e.g. from a wrong URL) still surfaces as a real
// permanent error.
function isEmptyResultBody(body) {
  if (typeof body !== 'string' || body.length === 0) return false;
  return /no matching records/i.test(body);
}

function truncateForLog(str, max) {
  if (typeof str !== 'string') return str;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function isoDateDaysAgo(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(now) {
  return new Date(now).toISOString().slice(0, 10);
}

module.exports = {
  PatentsViewWorker,
  SOURCE_ID,
  DEFAULT_ODP_ENDPOINT,
  isEmptyResultBody,
};
