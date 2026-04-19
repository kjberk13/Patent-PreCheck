'use strict';

// =====================================================================
// arXiv worker — Tier B
//
// Endpoint: http://export.arxiv.org/api/query
//   GET ?search_query=cat:cs.*&start=N&max_results=200
//       &sortBy=submittedDate&sortOrder=ascending
// Auth: none.
// Rate limit: arXiv asks for <= 1 req/3s for bulk. Default 0.25 rps.
//
// Response is an Atom feed. We parse it with a minimal entry-extractor
// (no XML dep needed for this feed shape; brittle on exotic input but
// this is a stable, published feed format).
//
// Cursor shape: { offset: <nonNegative integer> }
// Delta mode constrains the lookback window; backfill walks from offset=0.
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const { DocumentValidationError, SourceSchemaError } = require('../../shared/worker_errors.js');

const SOURCE_ID = 'arxiv';
const DEFAULT_ENDPOINT = 'http://export.arxiv.org/api/query';
const DEFAULT_PAGE_SIZE = 200;
// cs.* + stat.ML covers the categories we want for software novelty hits.
const DEFAULT_QUERY = 'cat:cs.* OR cat:stat.ML';

class ArxivWorker extends BaseWorker {
  constructor(opts = {}) {
    super({ requestsPerSecond: 0.33, ...opts });
    this.source_id = SOURCE_ID;
    this.tier = 'B';
    this.authEnvVar = null;
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
    this.query = opts.query || DEFAULT_QUERY;
    this.deltaLookbackDays = opts.deltaLookbackDays || 7;
  }

  async *pages({ mode, cursor }) {
    let offset = (cursor && cursor.offset) || 0;
    const perPage = this.pageSize;
    const deltaFrom = mode === 'delta' ? this._deltaFromDate() : null;

    while (true) {
      const url =
        `${this.endpoint}?search_query=${encodeURIComponent(this.query)}` +
        `&start=${offset}&max_results=${perPage}` +
        `&sortBy=submittedDate&sortOrder=ascending`;

      const res = await this.fetchPage(url);
      const xml = await res.text();
      const entries = parseArxivEntries(xml);

      if (entries.length === 0) return;

      const docs = deltaFrom
        ? entries.filter((e) => !e.submittedDate || new Date(e.submittedDate) >= deltaFrom)
        : entries;

      offset += entries.length;
      yield { docs, nextCursor: { offset } };

      if (entries.length < perPage) return;
    }
  }

  parseDocument(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new SourceSchemaError('arxiv entry is not an object');
    }
    const nativeId = raw.id;
    if (!nativeId || typeof nativeId !== 'string') {
      throw new DocumentValidationError('missing id', { nativeId, field: 'id' });
    }
    if (!raw.title || typeof raw.title !== 'string') {
      throw new DocumentValidationError('missing title', { nativeId, field: 'title' });
    }
    const title = raw.title.trim();
    const abstract = (raw.summary || '').trim();
    const embedText = `${title}\n\n${abstract}`.trim();
    if (embedText.length === 0) {
      throw new DocumentValidationError('empty embedText', { nativeId, field: 'embedText' });
    }
    return {
      native_id: nativeId,
      doc_type: 'paper',
      title,
      abstract,
      url: raw.link || null,
      published_at: raw.submittedDate || null,
      language: 'en',
      metadata: {
        authors: raw.authors || [],
        categories: raw.categories || [],
      },
      embedText,
    };
  }

  _deltaFromDate() {
    const d = new Date(this.now());
    d.setUTCDate(d.getUTCDate() - this.deltaLookbackDays);
    return d;
  }
}

// ---------------------------------------------------------------------
// Minimal Atom parser for arXiv responses.
// Not a general-purpose XML parser; only handles arXiv's stable feed shape.
// Exported for unit testing.
// ---------------------------------------------------------------------

function parseArxivEntries(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const entries = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const body = match[1];
    entries.push({
      id: text(body, 'id'),
      title: text(body, 'title'),
      summary: text(body, 'summary'),
      submittedDate: text(body, 'published') || text(body, 'updated'),
      link: linkHref(body),
      authors: allText(body, /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g),
      categories: allAttrs(body, /<category\b[^>]*\bterm="([^"]+)"/g),
    });
  }
  return entries;
}

function text(body, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(body);
  return m ? decode(m[1].trim()) : null;
}

function allText(body, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(body)) !== null) out.push(decode(m[1].trim()));
  return out;
}

function allAttrs(body, regex) {
  const out = [];
  let m;
  while ((m = regex.exec(body)) !== null) out.push(m[1]);
  return out;
}

function linkHref(body) {
  const m = /<link\b[^>]*\brel="alternate"[^>]*\bhref="([^"]+)"/.exec(body);
  if (m) return m[1];
  const simple = /<link\b[^>]*\bhref="([^"]+)"/.exec(body);
  return simple ? simple[1] : null;
}

function decode(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = { ArxivWorker, parseArxivEntries, SOURCE_ID };
