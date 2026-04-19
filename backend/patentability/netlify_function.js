// ─────────────────────────────────────────────────────────────────────────────
// Netlify Function: patentability-analyze
// Replaces the old analyze.js with the structured three-pillar patentability
// engine. Wires together prior art search → scoring → response.
//
// Deploy notes:
//   - Set env var ANTHROPIC_API_KEY in Netlify site settings
//   - Vector store is optional; if not configured, scoring proceeds without
//     prior art context (LLM-only assessment). This is acceptable for the
//     free tier initially; paid review requires prior art.
//   - Top-level package.json must include @anthropic-ai/sdk (Netlify does not
//     auto-install function-local package.json)
// ─────────────────────────────────────────────────────────────────────────────

const { scorePatentability } = require('./patentability_engine');
const { searchPriorArt }     = require('./prior_art_search');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json',
};

exports.handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // Parse
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { code, filename, tier } = body;
  if (!code || code.trim().length < 10) {
    return respond(400, { error: 'Please provide code or a description of your invention (at least 10 characters).' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return respond(500, { error: 'Analysis service is not currently configured. Please try again shortly.' });
  }

  // Step 1: Prior art search (non-fatal — LLM-only fallback if unavailable)
  let priorArtContext = [];
  try {
    const vectorStore = getVectorStoreIfConfigured();
    const search = await searchPriorArt({
      code,
      filename,
      tier: tier || 'free',
      vectorStore,
    });
    priorArtContext = search.results || [];
  } catch (err) {
    console.warn('Prior art search unavailable, proceeding without:', err.message);
  }

  // Step 2: Score patentability
  const result = await scorePatentability({
    code,
    filename,
    priorArtContext,
    apiKey,
  });

  if (result.error) {
    return respond(500, result);
  }

  return respond(200, result);
};

// ─────────────────────────────────────────────────────────────────────────────
// Vector store factory — returns null if not configured (acceptable for v1)
// Swap in Pinecone / pgvector / Weaviate adapter here when deployed
// ─────────────────────────────────────────────────────────────────────────────

function getVectorStoreIfConfigured() {
  if (process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX) {
    // Placeholder — real adapter lives in vector_search_adapter.js when wired up
    return null;
  }
  if (process.env.PGVECTOR_URL) {
    return null;
  }
  return null;
}

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
