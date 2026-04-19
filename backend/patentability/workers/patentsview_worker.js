'use strict';

// =====================================================================
// USPTO PatentsView worker — Tier A
//
// Endpoint: https://search.patentsview.org/api/v1/patent/
//   POST JSON: { q, f, s, o }
// Auth: none required for public data.
// Rate limit: generous; default 2 rps.
//
// Cursor shape: { lastPatentId: '<string>' }  (paginated by patent_id asc)
// Delta mode narrows the query to patents with patent_date in the last N days.
// Backfill starts from 2015-01-01 for CPC software classes.
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const { DocumentValidationError } = require('../../shared/worker_errors.js');

const SOURCE_ID = 'uspto-patentsview';
const DEFAULT_ENDPOINT = 'https://search.patentsview.org/api/v1/patent/';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_CPC_GROUPS = ['G06F', 'G06N', 'G06Q', 'H04L'];
const DEFAULT_BACKFILL_FROM = '2015-01-01';

class PatentsViewWorker extends BaseWorker {
  constructor(opts = {}) {
    super({ requestsPerSecond: 2, ...opts });
    this.source_id = SOURCE_ID;
    this.tier = 'A';
    this.authEnvVar = null;
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
    this.cpcGroups = opts.cpcGroups || DEFAULT_CPC_GROUPS;
    this.backfillFrom = opts.backfillFrom || DEFAULT_BACKFILL_FROM;
    this.deltaLookbackDays = opts.deltaLookbackDays || 7;
  }

  async *pages({ mode, cursor }) {
    let lastId = (cursor && cursor.lastPatentId) || null;
    while (true) {
      const query = this._buildQuery(mode, lastId);
      const res = await this.fetchPage(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
      });
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
      throw new DocumentValidationError('missing patent_title', { nativeId, field: 'patent_title' });
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
