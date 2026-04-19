'use strict';

// =====================================================================
// GitHub worker — Tier C
//
// Endpoint: https://api.github.com/search/repositories
//   GET ?q=stars:>50 language:javascript created:>=2024-01-01
//       &sort=stars&order=desc&per_page=100&page=N
// Auth: Bearer GITHUB_TOKEN required for any non-trivial throughput
//       (60 req/hr unauthenticated vs 5000 req/hr with a PAT).
// Rate limit: ~1 req/s keeps us well inside the search API's 30/min cap.
//
// Search API ceiling: GitHub caps pagination at 1000 results per query.
// Backfill strategy strings queries into buckets of <=1000 hits by
// narrowing the stars: range; this reference impl just walks one query
// so a caller knows to partition the space for a real backfill.
//
// Cursor shape: { page: <positive integer>, query: <string> }
// Delta mode restricts to `pushed:>=<N days ago>`.
// =====================================================================

const { BaseWorker } = require('../../shared/base_worker.js');
const {
  DocumentValidationError,
  SourceApiAuthError,
} = require('../../shared/worker_errors.js');

const SOURCE_ID = 'github-search';
const DEFAULT_ENDPOINT = 'https://api.github.com/search/repositories';
const DEFAULT_PER_PAGE = 100;
const DEFAULT_LANGUAGES = ['JavaScript', 'TypeScript', 'Python', 'Rust', 'Go', 'C++', 'Java'];
const SEARCH_API_HARD_CAP = 1000;

class GitHubWorker extends BaseWorker {
  constructor(opts = {}) {
    super({ requestsPerSecond: 1, ...opts });
    this.source_id = SOURCE_ID;
    this.tier = 'C';
    this.authEnvVar = 'GITHUB_TOKEN';
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.perPage = opts.perPage || DEFAULT_PER_PAGE;
    this.languages = opts.languages || DEFAULT_LANGUAGES;
    this.minStars = opts.minStars ?? 50;
    this.deltaLookbackDays = opts.deltaLookbackDays || 7;
    this.token = opts.token ?? process.env.GITHUB_TOKEN;
  }

  async *pages({ mode, cursor }) {
    if (!this.token) {
      throw new SourceApiAuthError(this.source_id, this.authEnvVar, 'token is not set');
    }

    const query = (cursor && cursor.query) || this._buildQuery(mode);
    let page = (cursor && cursor.page) || 1;

    const maxPages = Math.ceil(SEARCH_API_HARD_CAP / this.perPage);

    while (page <= maxPages) {
      const url =
        `${this.endpoint}?q=${encodeURIComponent(query)}` +
        `&sort=stars&order=desc&per_page=${this.perPage}&page=${page}`;

      const res = await this.fetchPage(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'patent-precheck-ingestor',
        },
      });
      const payload = await res.json();
      const items = payload && payload.items ? payload.items : [];
      if (items.length === 0) return;

      page += 1;
      yield { docs: items, nextCursor: { query, page } };

      if (items.length < this.perPage) return;
    }
  }

  parseDocument(raw) {
    const nativeId = raw && raw.id != null ? String(raw.id) : null;
    if (!nativeId) {
      throw new DocumentValidationError('missing id', { nativeId, field: 'id' });
    }
    const fullName = raw.full_name || null;
    if (!fullName) {
      throw new DocumentValidationError('missing full_name', { nativeId, field: 'full_name' });
    }
    const description = (raw.description || '').trim();
    const topics = Array.isArray(raw.topics) ? raw.topics : [];

    const embedTextParts = [fullName];
    if (description) embedTextParts.push(description);
    if (topics.length > 0) embedTextParts.push(`Topics: ${topics.join(', ')}`);
    const embedText = embedTextParts.join('\n\n');

    if (embedText.length === 0) {
      throw new DocumentValidationError('empty embedText', { nativeId, field: 'embedText' });
    }

    return {
      native_id: nativeId,
      doc_type: 'repo',
      title: fullName,
      abstract: description || null,
      url: raw.html_url || null,
      published_at: raw.created_at || null,
      language: 'en',
      metadata: {
        language: raw.language || null,
        stars: raw.stargazers_count ?? null,
        topics,
        default_branch: raw.default_branch || null,
      },
      embedText,
    };
  }

  _buildQuery(mode) {
    const langClause = this.languages.map((l) => `language:${l}`).join(' ');
    const parts = [`stars:>${this.minStars}`, langClause];
    if (mode === 'delta') {
      const d = new Date(this.now());
      d.setUTCDate(d.getUTCDate() - this.deltaLookbackDays);
      parts.push(`pushed:>=${d.toISOString().slice(0, 10)}`);
    }
    return parts.join(' ');
  }
}

module.exports = { GitHubWorker, SOURCE_ID };
