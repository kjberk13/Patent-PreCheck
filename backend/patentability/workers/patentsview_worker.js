'use strict';

// =====================================================================
// USPTO PatentsView worker — Tier A
//
// IMPORTANT — MIGRATION NOTICE (USPTO, Oct 2024):
//   The PatentsView API was merged into USPTO's Open Data Portal. The
//   previous anonymous endpoint now returns HTTP 410 Gone. Operators
//   must:
//     1. Register at https://developer.uspto.gov
//     2. Obtain an API key (free tier available)
//     3. Set USPTO_API_KEY in the worker host env
//     4. If USPTO has also changed the base URL (they may move it to
//        api.uspto.gov), override PATENTSVIEW_ENDPOINT accordingly.
//
//   The worker sends the key as X-Api-Key on every request. Without
//   the key the endpoint returns 401; the worker surfaces that as
//   SourceApiAuthError with a pointer back to developer.uspto.gov.
//
// Rate limit: generous with a key; default 2 rps.
// Cursor shape: { lastPatentId: '<string>' }
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const {
  DocumentValidationError,
  SourceApiAuthError,
  SourceApiPermanentError,
} = require('../../shared/worker_errors.js');

const SOURCE_ID = 'uspto-patentsview';
// Default endpoint as of the v1 POST-JSON API. USPTO may have moved it
// under the ODP umbrella; override via PATENTSVIEW_ENDPOINT if a 410
// comes back and developer.uspto.gov points you at a different URL.
const DEFAULT_ENDPOINT = 'https://search.patentsview.org/api/v1/patent/';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_CPC_GROUPS = ['G06F', 'G06N', 'G06Q', 'H04L'];
const DEFAULT_BACKFILL_FROM = '2015-01-01';

class PatentsViewWorker extends BaseWorker {
  constructor(opts = {}) {
    super({ requestsPerSecond: 2, ...opts });
    this.source_id = SOURCE_ID;
    this.tier = 'A';
    this.authEnvVar = 'USPTO_API_KEY';
    this.endpoint = opts.endpoint || process.env.PATENTSVIEW_ENDPOINT || DEFAULT_ENDPOINT;
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
        'register at developer.uspto.gov to obtain a free API key, then set USPTO_API_KEY in the worker host env',
      );
    }

    let lastId = (cursor && cursor.lastPatentId) || null;
    while (true) {
      const query = this._buildQuery(mode, lastId);

      let res;
      try {
        res = await this.fetchPage(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': this.apiKey,
          },
          body: JSON.stringify(query),
        });
      } catch (err) {
        // A 410 means USPTO has moved or retired this endpoint entirely.
        // Surface a specific, actionable error instead of the generic
        // "permanent HTTP 410" from classifyHttpError.
        if (err instanceof SourceApiPermanentError && err.status === 410) {
          throw new SourceApiPermanentError(
            `${this.source_id} endpoint returned HTTP 410 Gone (${this.endpoint}). ` +
              'USPTO migrated PatentsView to the Open Data Portal in Oct 2024. ' +
              'Check developer.uspto.gov for the current URL and set PATENTSVIEW_ENDPOINT ' +
              'to override the default.',
            { status: 410, body: err.body, source: this.source_id },
          );
        }
        throw err;
      }

      const payload = await res.json();
      const patents = payload && payload.patents ? payload.patents : [];
      if (patents.length === 0) return;

      yield {
        docs: patents,
        nextCursor: { lastPatentId: patents[patents.length - 1].patent_id },
      };

      lastId = patents[patents.length - 1].patent_id;
      if (patents.length < this.pageSize) return;
    }
  }

  parseDocument(raw) {
    const nativeId = raw && raw.patent_id;
    if (!nativeId) {
      throw new DocumentValidationError('missing patent_id', { nativeId, field: 'patent_id' });
    }
    const title = (raw.patent_title || '').trim();
    if (!title) {
      throw new DocumentValidationError('missing patent_title', {
        nativeId,
        field: 'patent_title',
      });
    }
    const abstract = (raw.patent_abstract || '').trim();
    const embedText = `${title}\n\n${abstract}`.trim();
    if (embedText.length === 0) {
      throw new DocumentValidationError('empty embedText', { nativeId, field: 'embedText' });
    }
    return {
      native_id: String(nativeId),
      doc_type: 'patent',
      title,
      abstract,
      url: `https://patents.google.com/patent/US${nativeId}`,
      published_at: raw.patent_date || null,
      language: 'en',
      metadata: {
        cpc_groups: raw.cpc_current || [],
        assignees: raw.assignees || [],
      },
      embedText,
    };
  }

  _buildQuery(mode, lastPatentId) {
    const dateFilter =
      mode === 'delta'
        ? { _gte: { patent_date: isoDateDaysAgo(this.now(), this.deltaLookbackDays) } }
        : { _gte: { patent_date: this.backfillFrom } };

    const cpcFilter = this.cpcGroups.map((g) => ({ 'cpc_current.cpc_group_id': g }));

    const q = {
      _and: [
        dateFilter,
        { _or: cpcFilter },
        ...(lastPatentId ? [{ _gt: { patent_id: lastPatentId } }] : []),
      ],
    };

    return {
      q,
      f: ['patent_id', 'patent_title', 'patent_abstract', 'patent_date', 'cpc_current', 'assignees'],
      s: [{ patent_id: 'asc' }],
      o: { size: this.pageSize },
    };
  }
}

function isoDateDaysAgo(now, days) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = { PatentsViewWorker, SOURCE_ID };
