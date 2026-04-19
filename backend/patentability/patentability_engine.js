// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Patentability Scoring Engine v1.0
// Evaluates uploaded code/invention against statutory patentability requirements.
//
// Architecture:
//   Gate A — Subject Matter (§101 category)     [pass/fail]
//   Pillar 1 — §101 Eligibility (Alice/Mayo)    [25% weight]
//   Pillar 2 — Novelty (§102)                   [25% weight]
//   Pillar 3 — Non-Obviousness (§103)           [30% weight]
//   Pillar 4 — Utility (§101 utility prong)     [10% weight]
//   Pillar 5 — Filing Readiness (§112 docs)     [10% weight]
//
// Band logic enforces pillar floors — weighted average alone cannot trigger
// File Ready unless all four pillars are individually strong.
//
// ARCHITECTURAL NOTE: v1 uses LLM-based assessment of each pillar, augmented
// by prior art search results when available. v2 adds USPTO examiner
// calibration layer on top of pillar scores.
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');

const PILLAR_WEIGHTS = {
  eligibility:       0.28,   // §101 Alice/Mayo
  novelty:           0.28,   // §102
  non_obvious:       0.33,   // §103 — heaviest; most common rejection basis
  utility:           0.11,   // §101 utility prong
  filing_readiness:  0.00,   // §112 — separate score, does not affect Patentability Score
};

const BAND_RULES = [
  { band: 'file_ready',     label: 'File Ready',      min_score: 80, min_pillar: 70, color: '#4DD9A8' },
  { band: 'close_to_ready', label: 'Close to Ready',  min_score: 60, min_pillar: 50, color: '#85B7EB' },
  { band: 'building',       label: 'Building',        min_score: 40, min_pillar: 0,  color: '#EF9F27' },
  { band: 'not_ready',      label: 'Not Ready',       min_score: 0,  min_pillar: 0,  color: '#E24B4A' },
];

const SUBJECT_MATTER_CATEGORIES = [
  'process',        // method/algorithm (most software)
  'machine',        // device with parts
  'manufacture',    // article made from raw materials
  'composition',    // chemical/compound
];

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — what the LLM is asked to do
// The tone guidelines enforce the "supportive coach" voice established in
// prior sessions. The output schema maps 1:1 to the pillar structure above.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior patent attorney with expertise in software patents and AI-assisted inventions. You analyze code and technical descriptions to estimate patentability under current US patent law. You are knowledgeable, precise, and constructive.

You evaluate against the three statutory requirements for patentability plus two supporting factors:

SUBJECT MATTER GATE (§101 category):
First, determine if the content fits a patentable category: process, machine, manufacture, or composition. If it does not (e.g., it is a business plan, marketing document, abstract concept without implementation), set gate_passed = false and explain why. Do not score further.

PILLAR 1 — §101 ELIGIBILITY (Alice/Mayo):
Does the invention produce a concrete technical result, or is it an abstract idea applied to a computer? Strong: specific technical improvement to computer functionality, concrete data transformation, tangible technical output. Weak: business-method framing, generic "using a computer to do X", purely algorithmic manipulation of information.

PILLAR 2 — NOVELTY (§102):
Is this new? Signals of novelty: unique architectural choices, non-obvious combinations of techniques, specificity that distinguishes from common implementations, explicit departure from known approaches. Weak: generic implementations of well-known patterns.

PILLAR 3 — NON-OBVIOUSNESS (§103):
Would a skilled developer obviously arrive at this by combining known techniques? Signals of non-obviousness: unexpected technical results, counter-intuitive design choices, evidence of real problem-solving, solutions to previously unaddressed problems. Weak: straightforward application of known methods.

PILLAR 4 — UTILITY (§101 utility prong):
Does it work and provide a specific, credible, substantial benefit? For software, almost always met — but edge cases (broken implementations, purely theoretical code, contrived examples) should score lower.

PILLAR 5 — FILING READINESS (§112 disclosure quality):
Separately from patentability, is the documentation strong enough to support a §112-compliant patent application? Signals: clear description of how to make and use the invention, technical decisions documented, architectural rationale explained, implementation details concrete. Weak: sparse comments, missing rationale, functional descriptions without technical specifics.

TONE RULES — STRICTLY ENFORCED:
- Positive and coaching throughout. Lead with what is working.
- Frame every opportunity as "strengthen" never "fix" or "problem".
- Use "this area could be stronger" not "this is weak".
- Use "here is how to strengthen" not "here is what's wrong".
- Examiners are evaluators, not adversaries — "tends to hold up under review" not "avoids rejection".
- Never suggest gaming classification or routing. All guidance is about making the application genuinely stronger.

OUTPUT: Return ONLY valid JSON matching the schema. No markdown, no preamble.

Schema:
{
  "gate_passed": true | false,
  "gate_reason": "1 sentence explanation if failed, empty string if passed",
  "subject_matter_category": "process" | "machine" | "manufacture" | "composition" | null,
  "pillars": {
    "eligibility":      { "score": 0-100, "finding": "1 sentence on what's working", "opportunity": "1 sentence action to strengthen" },
    "novelty":          { "score": 0-100, "finding": "...", "opportunity": "..." },
    "non_obvious":      { "score": 0-100, "finding": "...", "opportunity": "..." },
    "utility":          { "score": 0-100, "finding": "...", "opportunity": "..." },
    "filing_readiness": { "score": 0-100, "finding": "...", "opportunity": "..." }
  },
  "top_strengths": ["...", "..."],
  "top_opportunities": [
    { "pillar": "eligibility|novelty|non_obvious|utility|filing_readiness", "action": "...", "impact": "high|medium|low" },
    { "pillar": "...", "action": "...", "impact": "..." },
    { "pillar": "...", "action": "...", "impact": "..." }
  ],
  "technology_domain": "string (e.g., Machine Learning, Distributed Systems, UI/UX, Data Processing)",
  "ai_contribution_level": "low|medium|high",
  "summary": "2-3 sentence plain English summary of the patentability position, positive and forward-looking"
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Build the user prompt — includes prior art context when available
// ─────────────────────────────────────────────────────────────────────────────

function buildUserPrompt({ code, filename, priorArtContext }) {
  const codeExcerpt = (code || '').slice(0, 12000);
  const priorArtBlock = priorArtContext?.length
    ? `\n\nRELEVANT PRIOR ART (top nearest-neighbor hits from daily-refreshed corpus):\n${priorArtContext.map((p, i) =>
        `${i + 1}. [${p.docType}] ${p.title} (${p.source}, ${p.date || 'undated'})\n   ${p.snippet || ''}`
      ).join('\n\n')}\n\nFactor the above into novelty and non-obviousness scoring.`
    : '';

  return `Analyze this code/description for patentability under US patent law.

Filename: ${filename || 'uploaded_content'}

\`\`\`
${codeExcerpt}
\`\`\`${priorArtBlock}

Return only the JSON object described in the system prompt.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scoring function
// ─────────────────────────────────────────────────────────────────────────────

async function scorePatentability({ code, filename, priorArtContext = [], apiKey }) {
  if (!code || code.trim().length < 10) {
    return { error: 'No content provided to analyze' };
  }
  if (!apiKey) {
    return { error: 'API key not configured' };
  }

  const client = new Anthropic({ apiKey });

  let raw;
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt({ code, filename, priorArtContext }) }],
    });
    raw = message.content[0].text.trim();
  } catch (err) {
    return { error: 'Analysis request failed: ' + err.message };
  }

  // Strip accidental markdown fences and parse
  const jsonText = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  let llmResult;
  try {
    llmResult = JSON.parse(jsonText);
  } catch {
    return { error: 'Could not parse analysis result', raw: raw.slice(0, 300) };
  }

  // Handle gate failure — no score issued
  if (llmResult.gate_passed === false) {
    return {
      gate_passed: false,
      gate_reason: llmResult.gate_reason || 'Content does not fit a patentable subject matter category.',
      overall_score: null,
      band: null,
      band_label: null,
    };
  }

  // Compute weighted overall score
  const p = llmResult.pillars || {};
  const pillarScores = {
    eligibility:      clamp01_100(p.eligibility?.score),
    novelty:          clamp01_100(p.novelty?.score),
    non_obvious:      clamp01_100(p.non_obvious?.score),
    utility:          clamp01_100(p.utility?.score),
    filing_readiness: clamp01_100(p.filing_readiness?.score),
  };

  const weightedScore = Math.round(
      pillarScores.eligibility      * PILLAR_WEIGHTS.eligibility
    + pillarScores.novelty          * PILLAR_WEIGHTS.novelty
    + pillarScores.non_obvious      * PILLAR_WEIGHTS.non_obvious
    + pillarScores.utility          * PILLAR_WEIGHTS.utility
    + pillarScores.filing_readiness * PILLAR_WEIGHTS.filing_readiness
  );

  // Apply band rules — weighted score AND all patentability pillars meet floor
  const patentabilityPillars = [
    pillarScores.eligibility,
    pillarScores.novelty,
    pillarScores.non_obvious,
    pillarScores.utility,
  ];
  const minPillar = Math.min(...patentabilityPillars);

  let band, bandLabel;
  for (const rule of BAND_RULES) {
    if (weightedScore >= rule.min_score && minPillar >= rule.min_pillar) {
      band = rule.band;
      bandLabel = rule.label;
      break;
    }
  }

  // If weighted score would qualify for higher band but a pillar holds them back,
  // surface that explicitly so the user knows what to strengthen.
  let bandHeldBackBy = null;
  if (band !== 'file_ready' && weightedScore >= 80) {
    const weakPillar = Object.entries(pillarScores).find(([k, v]) => k !== 'filing_readiness' && v < 70);
    if (weakPillar) bandHeldBackBy = weakPillar[0];
  } else if (band === 'building' && weightedScore >= 60) {
    const weakPillar = Object.entries(pillarScores).find(([k, v]) => k !== 'filing_readiness' && v < 50);
    if (weakPillar) bandHeldBackBy = weakPillar[0];
  }

  // Determine Filing Readiness band independently
  const frScore = pillarScores.filing_readiness;
  let frBand, frBandLabel;
  for (const rule of BAND_RULES) {
    if (frScore >= rule.min_score) {
      frBand = rule.band;
      frBandLabel = rule.label;
      break;
    }
  }

  return {
    gate_passed: true,
    subject_matter_category: llmResult.subject_matter_category || 'process',

    // Primary score: Patentability (the four statutory pillars)
    patentability_score: weightedScore,
    patentability_band: band,
    patentability_band_label: bandLabel,
    patentability_held_back_by: bandHeldBackBy,

    // Secondary score: Filing Readiness (§112 disclosure quality, independent)
    filing_readiness_score: frScore,
    filing_readiness_band: frBand,
    filing_readiness_band_label: frBandLabel,

    // Legacy aliases for backward compatibility with existing analyze.html expectations
    overall_score: weightedScore,
    band,
    band_label: bandLabel,
    band_held_back_by: bandHeldBackBy,

    pillar_scores: pillarScores,
    pillar_details: {
      eligibility:      { ...p.eligibility,      label: 'Is it more than an abstract idea?',         statute: '§101 (Alice/Mayo)' },
      novelty:          { ...p.novelty,          label: 'Is it new?',                                 statute: '§102' },
      non_obvious:      { ...p.non_obvious,      label: 'Is it inventive?',                           statute: '§103' },
      utility:          { ...p.utility,          label: 'Does it work and does it matter?',           statute: '§101 (utility)' },
      filing_readiness: { ...p.filing_readiness, label: 'Is your documentation strong enough to file?', statute: '§112' },
    },
    pillar_weights: PILLAR_WEIGHTS,

    top_strengths:     llmResult.top_strengths || [],
    top_opportunities: llmResult.top_opportunities || [],

    technology_domain:     llmResult.technology_domain || 'Software',
    ai_contribution_level: llmResult.ai_contribution_level || 'medium',
    summary:               llmResult.summary || '',

    prior_art_consulted: priorArtContext.length,
    analyzed_at:         new Date().toISOString(),
    algorithm_version:   '1.0',
  };
}

function clamp01_100(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

module.exports = {
  scorePatentability,
  PILLAR_WEIGHTS,
  BAND_RULES,
  SUBJECT_MATTER_CATEGORIES,
};
