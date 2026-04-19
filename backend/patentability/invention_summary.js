'use strict';

// =====================================================================
// Invention summary — a pre-flight Claude call that produces a compact
// natural-language paragraph optimized for embedding + retrieval
// against patent abstracts and CS paper abstracts.
//
// Rationale: raw code embeds poorly because embedding models are
// trained on natural language. Summarizing the invention first in
// canonical technical vocabulary dramatically improves retrieval.
//
// The summary is intentionally NOT user-facing — it's dense, jargon-
// normalized text designed to sit next to a patent abstract in
// embedding space. It doubles as context for the scoring prompt.
// =====================================================================

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 500;
const MAX_INPUT_CHARS = 12000; // same cap scorePatentability() uses

const SUMMARY_SYSTEM_PROMPT = `You are a summarizer whose output feeds a semantic-search system over patents and CS papers. Produce ONE paragraph, 150–200 words, describing an invention from uploaded code or text. The goal is retrieval quality, not human readability.

The paragraph must:
- State what the invention does (domain + function) in concrete terms.
- Describe how it does it (technique, architecture, data flow, key operations).
- Identify what is distinctive about the approach — the specific design choices that separate it from a generic implementation.
- Use established technical vocabulary. Prefer the terms a patent examiner or CS paper abstract would use. Avoid marketing language ("novel", "innovative", "cutting-edge", "revolutionary"), first-person voice, and filler.
- Never include code, variable names, library names, or boilerplate implementation details that would not appear in a patent abstract.
- Be a single paragraph with no headings, no bullet points, no markdown, no preamble.`;

async function buildInventionSummary({
  code,
  filename,
  anthropic,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
}) {
  if (!anthropic) throw new TypeError('buildInventionSummary requires { anthropic }');
  if (typeof code !== 'string' || code.trim().length < 10) {
    throw new TypeError('buildInventionSummary requires code text (min 10 chars)');
  }

  const excerpt = code.slice(0, MAX_INPUT_CHARS);
  const userPrompt =
    `Filename: ${filename || 'uploaded_content'}\n\n` +
    '```\n' +
    excerpt +
    '\n```\n\n' +
    'Write the summary paragraph as described in the system prompt. Output only the paragraph text.';

  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = message?.content?.[0]?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('invention summary returned empty text');
  }
  return text.trim();
}

module.exports = { buildInventionSummary, SUMMARY_SYSTEM_PROMPT };
