'use strict';

// =====================================================================
// Netlify Function: patentability-analyze
//
// Flow:
//   1. Parse + validate request { code, filename, tier }
//   2. Pre-flight Claude call → embedding-optimized invention summary
//   3. Embed the summary (Voyage primary, OpenAI fallback)
//   4. Vector search against Neon pgvector (tier-gated source selection)
//   5. Score patentability with the retrieved prior art as context
//   6. Return: always { prior_art_match_count }; paid tiers also get
//      { prior_art_matches: [...] }
//
// Graceful degradation:
//   • DB unreachable / no rows → log warning, proceed with empty prior
//     art. scorePatentability() handles that path cleanly.
//   • Summary call fails → log warning, embed the raw code excerpt.
//
// Deploy notes (Phase 2.5):
//   • Set in Netlify env: ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
//     VOYAGE_API_KEY (+ optional OPENAI_API_KEY for fallback),
//     EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
//     DATABASE_URL (Neon direct), DATABASE_URL_POOLED (Neon pooled),
//     SITE_URL, LOG_LEVEL.
//   • Top-level package.json includes @anthropic-ai/sdk and
//     @neondatabase/serverless (Netlify does not auto-install
//     function-local package.json).
//
// Parallelism/scale note:
//   Each Lambda invocation constructs its own Anthropic, Embeddings,
//   and neon() clients. @neondatabase/serverless uses fetch under the
//   hood, so there is no long-lived connection state to reuse across
//   invocations. If we ever need higher throughput, swap neon() for
//   the WebSocket Pool and reuse it across invocations within a warm
//   container.
// =====================================================================

const Anthropic = require('@anthropic-ai/sdk');
const { neon } = require('@neondatabase/serverless');

const { scorePatentability } = require('./patentability_engine.js');
const { searchPriorArt } = require('./prior_art_search.js');
const { buildInventionSummary } = require('./invention_summary.js');
const { Embeddings } = require('../shared/embeddings.js');
const { NullCache } = require('../shared/embedding_cache.js');
const {
  VectorSearchAdapter,
  neonRunQuery,
} = require('../shared/vector_search_adapter.js');
const registry = require('./workers/registry.js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const KNOWN_TIERS = new Set(['free', 'paid_review', 'enterprise']);
const PAID_TIERS = new Set(['paid_review', 'enterprise']);

let coldStartLogged = false;

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { code, filename } = body;
  if (!code || typeof code !== 'string' || code.trim().length < 10) {
    return respond(400, {
      error:
        'Please provide code or a description of your invention (at least 10 characters).',
    });
  }

  // TIER GATING — v1: trust the client.
  //   The frontend only sends tier: 'free' in v1. Crafting a paid-tier
  //   request requires a custom API call (not casual abuse). Real gating
  //   lands with Stripe integration in Phase 2.6, which will verify a
  //   signed session token against Stripe before honoring a paid tier.
  // TODO(phase-2.6): replace with Stripe-backed gating.
  const tier = normalizeTier(body.tier);
  const isPaidTier = PAID_TIERS.has(tier);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond(500, {
      error: 'Analysis service is not currently configured. Please try again shortly.',
    });
  }

  logColdStartOnce();

  const anthropic = new Anthropic({ apiKey });

  // STEP 1: Pre-flight summary (embedding-optimized)
  let summary;
  try {
    summary = await buildInventionSummary({ code, filename, anthropic });
    log('info', { event: 'invention_summary_built', summary_chars: summary.length });
  } catch (err) {
    log('warn', { event: 'invention_summary_failed', error: err.message });
    // Fall back to raw code excerpt. Retrieval quality suffers but the
    // user still gets a scored response.
    summary = code.slice(0, 4000);
  }

  // STEP 2+3: Embed the summary + vector search (with graceful degradation)
  const priorArtContext = await runPriorArtSearch({ summary, tier, code, filename });

  // STEP 4: Score
  const result = await scorePatentability({
    code,
    filename,
    priorArtContext,
    apiKey,
  });

  if (result.error) {
    return respond(500, result);
  }

  // STEP 5: Tier-gated response shape
  result.prior_art_match_count = priorArtContext.length;
  if (isPaidTier && priorArtContext.length > 0) {
    result.prior_art_matches = priorArtContext.map(toPublicMatch);
  }
  result.invention_summary = summary;
  result.tier = tier;

  return respond(200, result);
};

// ---------------------------------------------------------------------

async function runPriorArtSearch({ summary, tier, code, filename }) {
  const vectorStore = buildVectorStoreIfConfigured();
  if (!vectorStore) {
    log('warn', { event: 'vector_store_not_configured' });
    return [];
  }

  try {
    const { results } = await searchPriorArt({
      code: summary, // summary is both the embed target and domain-classifier input
      filename,
      tier,
      vectorStore,
      originalCode: code,
    });
    return results || [];
  } catch (err) {
    log('warn', { event: 'vector_search_failed', error: err.message });
    return [];
  }
}

function buildVectorStoreIfConfigured() {
  const dbUrl = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!dbUrl) return null;

  const embeddings = new Embeddings({
    // In Lambda, NullCache: no pg pool to share with the cache path,
    // and the per-invocation cache hit rate on unique user inputs is ~0.
    cache: new NullCache(),
  });

  const sql = neon(dbUrl);
  const adapter = new VectorSearchAdapter({
    embeddings,
    runQuery: neonRunQuery(sql),
    registry,
    logger: log,
  });

  return adapter;
}

function toPublicMatch(p) {
  return {
    title: p.title,
    source: p.source_name || p.source_id || 'unknown',
    source_id: p.source_id || null,
    source_tier: p.source_tier || null,
    doc_type: p.doc_type || p.docType || null,
    url: p.url || null,
    date: p.date || null,
    snippet: p.snippet || (p.abstract ? String(p.abstract).slice(0, 400) : null),
    similarity: round4(p.similarity_score ?? p.similarity ?? null),
  };
}

function normalizeTier(t) {
  if (typeof t !== 'string') return 'free';
  return KNOWN_TIERS.has(t) ? t : 'free';
}

function logColdStartOnce() {
  if (coldStartLogged) return;
  coldStartLogged = true;
  const poolUrlSet = Boolean(process.env.DATABASE_URL_POOLED);
  const directUrlSet = Boolean(process.env.DATABASE_URL);
  log('info', {
    event: 'function_cold_start',
    database_url_pooled: poolUrlSet,
    database_url: directUrlSet,
    using: poolUrlSet ? 'pooled' : directUrlSet ? 'direct' : 'none',
    anthropic_model: process.env.ANTHROPIC_MODEL || null,
    embedding_provider: process.env.EMBEDDING_PROVIDER || null,
  });
}

function log(level, event) {
  const want = process.env.LOG_LEVEL || 'info';
  if (level === 'debug' && want !== 'debug') return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, ts: new Date().toISOString(), ...event }));
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function round4(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 10000) / 10000;
}
