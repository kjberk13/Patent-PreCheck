const Anthropic = require("@anthropic-ai/sdk");

exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { code, filename } = body;
  if (!code || code.trim().length < 10) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No code content provided" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a senior patent attorney specializing in software patents and AI-assisted inventions. You analyze code and technical documents to estimate patent eligibility and strength under current US patent law.

You evaluate code across six dimensions, each scored 0-100:
1. Section 101 Eligibility (Alice/Mayo test) - Is this more than an abstract idea? Does it produce a concrete technical result?
2. Novelty Indicators - Evidence of novel approaches, non-obvious combinations, unique architectures
3. Human Conception Evidence - Clear signs of independent human creative decisions vs AI-generated boilerplate
4. Technical Specificity - Concreteness of implementation, specificity of claims, technical detail
5. Prior Art Risk - Likelihood similar implementations already exist
6. Documentation Strength - Quality of comments, decision records, algorithmic reasoning

Return ONLY valid JSON matching this exact schema — no markdown, no preamble:
{
  "overall_score": <integer 0-100>,
  "band": <"not_ready"|"building"|"strong"|"file_ready">,
  "band_label": <"Not Ready"|"Building"|"Strong Position"|"File Ready">,
  "summary": <2-3 sentence plain English summary of the patent position>,
  "dimensions": {
    "section_101": { "score": <int>, "label": "Section 101 Eligibility", "finding": <1 sentence>, "opportunity": <1 sentence action> },
    "novelty": { "score": <int>, "label": "Novelty Indicators", "finding": <1 sentence>, "opportunity": <1 sentence action> },
    "human_conception": { "score": <int>, "label": "Human Conception Evidence", "finding": <1 sentence>, "opportunity": <1 sentence action> },
    "technical_specificity": { "score": <int>, "label": "Technical Specificity", "finding": <1 sentence>, "opportunity": <1 sentence action> },
    "prior_art_risk": { "score": <int>, "label": "Prior Art Risk", "finding": <1 sentence>, "opportunity": <1 sentence action> },
    "documentation": { "score": <int>, "label": "Documentation Strength", "finding": <1 sentence>, "opportunity": <1 sentence action> }
  },
  "top_strengths": [<string>, <string>],
  "top_opportunities": [
    { "area": <string>, "action": <string>, "impact": <"high"|"medium"|"low"> },
    { "area": <string>, "action": <string>, "impact": <"high"|"medium"|"low"> },
    { "area": <string>, "action": <string>, "impact": <"high"|"medium"|"low"> }
  ],
  "ai_contribution_level": <"low"|"medium"|"high">,
  "technology_domain": <string e.g. "Machine Learning", "Distributed Systems", "UI/UX", "Data Processing">,
  "section_101_risk": <"low"|"medium"|"high">,
  "geographic_flag": <"none"|"review_recommended">
}

Band thresholds: 0-39 = not_ready, 40-59 = building, 60-79 = strong, 80-100 = file_ready

Be honest but constructive. Lead with what's working. Frame opportunities positively ("Add X to strengthen Y" not "Missing X").`;

  const userPrompt = `Analyze this code for patent eligibility. Filename: ${filename || "uploaded_file"}

\`\`\`
${code.slice(0, 12000)}
\`\`\`

Return only the JSON object described in the system prompt.`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = message.content[0].text.trim();

    // Strip any accidental markdown fences
    const jsonText = rawText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();

    let result;
    try {
      result = JSON.parse(jsonText);
    } catch {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to parse analysis result", raw: rawText.slice(0, 200) }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    console.error("Anthropic API error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Analysis failed: " + err.message }) };
  }
};
