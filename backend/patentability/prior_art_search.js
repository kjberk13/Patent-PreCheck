// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Prior Art Search Layer v1.0
// Retrieves the top nearest-neighbor prior art documents for a given
// invention description, to be passed into patentability_engine.scorePatentability().
//
// Architecture decisions (per Kevin's directives):
//   - Free sources only (Tiers A–G)
//   - Cached subset, not full corpus (software-related patents, CS papers, high-star repos)
//   - Daily delta updates (USPTO publishes Tuesdays; arXiv publishes daily; GitHub continuous)
//
// v1 scope — this file defines the INTERFACE. The actual embedding/search
// infrastructure is deployed separately (pgvector or Pinecone). The daily
// ingestion workers are in ingestion_pipeline.js.
// ─────────────────────────────────────────────────────────────────────────────

const { PATENTABILITY_SOURCES, BY_PILLAR } = require('./patentability_sources');

// ─────────────────────────────────────────────────────────────────────────────
// Domain classifier — route the search to the right sub-corpora
// (AI/ML invention → arXiv + Papers With Code + Hugging Face weighted heavy)
// (Networking → RFCs + IEEE)
// (Crypto → NIST + academic)
// etc.
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_KEYWORDS = {
  'ai_ml':          ['neural', 'transformer', 'llm', 'gpt', 'model', 'training', 'inference', 'embedding', 'classifier', 'reinforcement', 'fine-tun', 'prompt', 'token', 'attention', 'diffusion', 'ml model'],
  'networking':     ['protocol', 'tcp', 'udp', 'http', 'packet', 'socket', 'tls', 'handshake', 'routing', 'bgp', 'dns', 'cdn', 'latency', 'bandwidth'],
  'crypto':         ['crypto', 'cipher', 'encrypt', 'decrypt', 'hash', 'signature', 'key exchange', 'aes', 'rsa', 'ecdsa', 'zk-proof', 'zero-knowledge', 'merkle'],
  'distributed':    ['consensus', 'raft', 'paxos', 'distributed', 'sharding', 'replication', 'leader election', 'quorum', 'gossip', 'vector clock', 'crdt'],
  'data_systems':   ['database', 'query', 'index', 'b-tree', 'sql', 'nosql', 'transaction', 'commit', 'cache', 'storage engine', 'write-ahead log', 'lsm'],
  'ui_ux':          ['render', 'ui', 'ux', 'component', 'react', 'vue', 'widget', 'layout', 'accessibility', 'gesture', 'animation', 'dom'],
  'compilers':      ['compiler', 'parser', 'ast', 'lexer', 'bytecode', 'jit', 'optimization pass', 'register alloc', 'lowering'],
  'security':       ['auth', 'oauth', 'sso', 'csrf', 'xss', 'sanitize', 'vuln', 'exploit', 'sandbox', 'isolation', 'permission', 'capability'],
};

function classifyDomain(text) {
  const lower = (text || '').toLowerCase();
  const scores = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    scores[domain] = keywords.reduce((n, k) => n + (lower.includes(k) ? 1 : 0), 0);
  }
  const sorted = Object.entries(scores).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : 'general';
}

// ─────────────────────────────────────────────────────────────────────────────
// Source selection per domain — emphasizes the right tiers for the invention type
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_SOURCE_WEIGHTS = {
  ai_ml:        { 'G': 1.5, 'B': 1.2, 'A': 1.0, 'C': 0.8, 'E': 1.0, 'D': 0.5, 'F': 0.3 },
  networking:   { 'F': 1.5, 'A': 1.2, 'B': 1.0, 'C': 1.0, 'E': 1.0, 'D': 0.3, 'G': 0.3 },
  crypto:       { 'F': 1.5, 'B': 1.3, 'A': 1.2, 'C': 0.8, 'E': 1.0, 'D': 0.5, 'G': 0.3 },
  distributed:  { 'A': 1.3, 'B': 1.2, 'C': 1.0, 'E': 1.0, 'G': 0.5, 'F': 0.7, 'D': 0.3 },
  data_systems: { 'A': 1.3, 'B': 1.2, 'C': 1.0, 'E': 1.0, 'G': 0.5, 'F': 0.5, 'D': 0.3 },
  ui_ux:        { 'A': 1.0, 'C': 1.3, 'B': 0.8, 'E': 0.8, 'F': 0.8, 'G': 0.3, 'D': 0.3 },
  compilers:    { 'A': 1.2, 'B': 1.3, 'C': 1.0, 'E': 0.8, 'F': 0.3, 'G': 0.3, 'D': 0.3 },
  security:     { 'F': 1.3, 'A': 1.2, 'B': 1.0, 'C': 1.0, 'E': 0.8, 'D': 0.3, 'G': 0.3 },
  general:      { 'A': 1.0, 'B': 1.0, 'C': 1.0, 'E': 1.0, 'F': 1.0, 'D': 1.0, 'G': 1.0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Search tier — differentiates free vs paid analysis depth
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_TIERS = {
  free:        { max_results: 10, search_sources: ['A', 'C'],                   timeout_ms: 8000,   note: 'Fast search: patents + public code only' },
  paid_review: { max_results: 50, search_sources: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], timeout_ms: 30000, note: 'Deep search: full corpus including examination data' },
  enterprise:  { max_results: 200, search_sources: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], timeout_ms: 60000, note: 'Comprehensive search with paid tiers when enabled' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Core search interface — called before scorePatentability()
//
// v1 implementation: returns the structured query to be issued against the
// vector store. Actual vector similarity search is wired up in
// vector_search_adapter.js (uses pgvector by default, swappable for Pinecone).
// ─────────────────────────────────────────────────────────────────────────────

async function searchPriorArt({ code, filename, tier = 'free', vectorStore }) {
  const text = (code || '').slice(0, 12000);
  const domain = classifyDomain(text);
  const searchTier = SEARCH_TIERS[tier] || SEARCH_TIERS.free;
  const weights = DOMAIN_SOURCE_WEIGHTS[domain] || DOMAIN_SOURCE_WEIGHTS.general;

  // Build the search plan
  const plan = {
    domain,
    tier,
    max_results:    searchTier.max_results,
    source_weights: weights,
    source_tiers:   searchTier.search_sources,
    timeout_ms:     searchTier.timeout_ms,
    query_text:     text,
    generated_at:   new Date().toISOString(),
  };

  // If no vector store is available (dev/test), return plan only
  if (!vectorStore) {
    return { plan, results: [], note: 'No vector store attached — plan only' };
  }

  // Execute search
  let results;
  try {
    results = await vectorStore.search({
      query:         text,
      limit:         searchTier.max_results,
      source_tiers:  searchTier.search_sources,
      source_weights: weights,
    });
  } catch (err) {
    return { plan, results: [], error: 'Vector search failed: ' + err.message };
  }

  // Normalize results to the shape scorePatentability() expects
  const normalized = (results || []).map(r => ({
    title:       r.title || '(untitled)',
    source:      r.source_name || r.source_id || 'unknown',
    docType:     r.doc_type || 'document',
    date:        r.date || null,
    url:         r.url || null,
    snippet:     (r.snippet || r.abstract || '').slice(0, 400),
    similarity:  r.similarity_score ?? null,
    tier:        r.source_tier || null,
  }));

  return { plan, results: normalized };
}

// ─────────────────────────────────────────────────────────────────────────────
// Format prior art results for human-readable display alongside the score
// ─────────────────────────────────────────────────────────────────────────────

function formatPriorArtForDisplay(results, { maxToShow = 5 } = {}) {
  return (results || []).slice(0, maxToShow).map(r => ({
    title:          r.title,
    source:         r.source,
    type:           humanizeDocType(r.docType),
    date:           r.date,
    relevance:      r.similarity != null ? Math.round(r.similarity * 100) + '%' : null,
    why_it_matters: r.snippet,
    link:           r.url,
  }));
}

function humanizeDocType(t) {
  const map = {
    'patent':        'Granted patent',
    'paper':         'Academic paper',
    'paper-code':    'Paper with reference implementation',
    'code':          'Open-source code',
    'package':       'Published package',
    'disclosure':    'Defensive publication',
    'standard':      'Technical standard',
    'office-action': 'USPTO office action',
    'ptab':          'PTAB decision',
    'prosecution':   'Patent prosecution record',
    'model':         'Published ML model',
    'discussion':    'Technical discussion',
    'product':       'Public product launch',
    'bulk':          'Bulk USPTO data',
    'manual':        'USPTO examination manual',
    'classification':'USPTO classification data',
    'statistics':    'USPTO statistics',
    'document':      'Document',
  };
  return map[t] || 'Reference';
}

module.exports = {
  searchPriorArt,
  classifyDomain,
  formatPriorArtForDisplay,
  SEARCH_TIERS,
  DOMAIN_KEYWORDS,
  DOMAIN_SOURCE_WEIGHTS,
};
