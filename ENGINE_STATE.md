# ENGINE_STATE.md — Patent PreCheck Engine Behavior

**Scope:** Two-score architecture, traffic-light bands, four pillars, AI-assisted inventorship scoring (50/35/15 formula and evidence categories).
**Parent:** `PROJECT_STATE.md` (index)

---

## Engine Behavior

### Two-Score Architecture
Every analysis returns two scores:

**Patentability (0–100)** — "Is it new, inventive, useful?"
- Built from four pillars (see below)

**Filing Readiness (0–100)** — "Is your documentation filing-ready?"
- Independent measure of whether the documentation itself is sufficient to file

### Four-Band Traffic Light
Scores translate to:
- 0–24: "Not ready" (red)
- 25–49: "Building" (amber-low)
- 50–74: "Close to ready" (amber-high / blue)
- 75–100: "Ready to file" (green)

### Four Pillars
- **§101 Eligibility** — "Is it more than an abstract idea?"
- **§102 Novelty** — "Is it new?"
- **§103 Non-obviousness** — "Is it inventive?"
- **§101 Utility** — "Does it work and matter?"

### Analysis flow (free tier)
1. User pastes code/description on `/analyze.html`
2. Netlify Lambda `analyze.js` receives request
3. Lambda calls Claude to summarize the invention
4. Lambda embeds the summary via Voyage (1024-dim)
5. Lambda queries Neon for top similar vectors (cosine similarity + tier weighting)
6. Lambda runs the patentability engine with full context
7. Results render: two scores + four pillar cards + prior art matches (paid only) + strengthen suggestions

### Report ID Format
`PPC-YYYY-MM-DD-XXXX` where XXXX is a 5-char alphanumeric string. Example: `PPC-2026-04-21-AA3J9`. Used as the report identifier across the free tier, paid tier, and PDF generation.

**Paid tier extensions** (see FEATURES_STATE.md for full Interactive Code Review spec):
- IDF document ID: `PPC-YYYY-MM-DD-XXXX-IDF`
- Patent application draft ID: `PPC-YYYY-MM-DD-XXXX-APP`

---

## AI-Assisted Inventorship Evaluation (LOCKED as of 2026-04-22)

### The current USPTO standard

**Effective November 28, 2025**, USPTO Director John Squires issued revised guidance ("Revised Inventorship Guidance for AI-Assisted Inventions," 90 Fed. Reg. 54636) that rescinded the February 2024 guidance entirely.

**Current test (what Patent PreCheck evaluates against):**
- AI systems are treated as tools — analogous to laboratory equipment, software, research databases
- The traditional conception standard applies: did a natural person form a "definite and permanent idea of the complete and operative invention"?
- No separate or modified standard for AI-assisted inventions
- The Pannu factors (from the rescinded 2024 guidance) no longer apply to single-human AI-assisted inventions
- Only natural persons can be inventors
- No percentage threshold exists in law — the legal test is qualitative

### The 4-Category Compliance Framework (LOCKED — core product IP)

Patent PreCheck evaluates human contribution against a four-category framework derived from USPTO 2025 guidance and practice recommendations from Morgan Lewis, Holland & Knight, Kilpatrick Townsend, and JD Supra. This framework is how the engine determines whether human conception is adequately documented.

**Category 1 — Human-Defined Frameworks**
Evidence that a human (not the AI) identified the technical problem, set design constraints, and formed a definite permanent idea of the solution.
- 1a. Problem framing — written statement of the specific technical problem, including why prior approaches failed
- 1b. Hypothesis and design — timestamped record of the moment a specific solution (not just a goal) was articulated
- Required outputs: design constraints documented, conception moment identified, pre-AI evidence preserved

**Category 2 — Interaction and Prompt Records**
Detailed records of specific prompts provided to AI, plus version control tracking how humans refined AI outputs.
- 2a. Prompt engineering logs — every prompt captured with a specificity score (0-100). Strategic direction scores high; generic goals score low.
- 2b. Version control — time-stamped record of every AI-generated block, which version was accepted, what modifications were made, diff-level documentation

**Category 3 — Human Decision-Making Evidence**
Documentation of why AI outputs were accepted, rejected, or modified. Per Holland & Knight guidance, "choosing the best result based on human expertise" is itself an act of conception.
- 3a. Selection and rejection records — written rationale for each significant AI suggestion rejected; note on verbatim vs. modified acceptance
- 3b. Refinement and modification documentation — what AI produced, what was changed, why the modification was technically necessary

**Category 4 — Internal Compliance Checklists**
Structured forms ensuring every claimed feature has at least one human contributor.
- 4a. Invention Disclosure Form (IDF) — identifies only natural persons, flags AI tool use, describes human contribution per feature
- 4b. Inventor Interview Checklist — Morgan Lewis-recommended structured interview before drafting
- 4c. AI Tool Disclosure Statement — proactive disclosure supporting the duty of candor

### The scoring algorithm (LOCKED)

The AI Patentability Score is a weighted composite of three sub-scores:

| Sub-score | Weight | Legal basis |
|---|---|---|
| Human conception strength | **50%** | Thaler v. Vidal; USPTO 2025 Revised Guidance |
| Section 101 technical specificity | **35%** | Recentive Analytics v. Fox Corp.; Rensselaer v. Amazon; Alice Corp. v. CLS Bank |
| Documentation quality | **15%** | Alice Step 2 inventive concept; 37 C.F.R. § 1.63 oath requirements |

### Evidence-based percentage scoring (LOCKED as of 2026-04-22)

Percentages surfaced to users represent **DOCUMENTATION EVIDENCE COMPLETENESS**, not human contribution percentage. This is a critical distinction: no percentage is required under current USPTO guidance, but certain categories of evidence ARE required for the conception test to be satisfied.

**Four evidence categories (each scored 0-100% per claim):**

1. **Problem Framing Evidence** — how thoroughly is the user's identification of the technical problem documented? Did they articulate it before or independently of AI?
2. **Constraint Documentation** — how specifically are the design/performance/technical constraints recorded? Things a generic AI prompt couldn't know from its training data.
3. **Conception Moment Evidence** — is there a timestamped record showing when the user formed the specific solution (not just a goal)? Emails, commits, journal entries, design docs.
4. **Decision Record** — are the user's AI accept/reject/modify choices documented with domain-informed rationale?

**These four categories compose the "Human Conception Strength" sub-score** (50% weight in the overall Patentability Score per the 50/35/15 formula above).

**Scoring rubric for each category (applied per Q&A answer):**

| Score | Answer Quality |
|---|---|
| 0% | No answer / no evidence |
| 15-25% | Vague or goal-level answer ("I wanted to solve X") |
| 40-60% | Specific answer, no supporting documentation |
| 70-85% | Specific answer + reference to documentation |
| 100% | Specific answer + timestamped/verifiable documentation |

**Example Q&A-to-score mapping:**

| Question | Category | Example 0% | Example 50% | Example 100% |
|---|---|---|---|---|
| "Was the original idea yours? When did you first identify the problem?" | Problem Framing | No answer | "I wanted to solve performance issues" | "On 3/15/26 I wrote in my journal that existing systems couldn't handle bursty arrival patterns because..." |
| "What technical constraints shaped your approach?" | Constraint Documentation | No answer | "It had to be fast" | "Had to handle 10K req/sec with <200ms p99 latency on 4-core hardware, with budget of 2GB memory per instance" |
| "When did you articulate the specific solution (not a goal)?" | Conception Moment | No answer | "Sometime in March" | "3/22/26 Slack message to myself: 'use rolling variance not moving average to detect bursts' — archived link attached" |
| "Describe an AI suggestion you rejected and why" | Decision Record | No answer | "I changed some stuff" | "Copilot suggested using EMA. I rejected because EMA smooths out variance, which is precisely the signal I need to detect bursts. Documented in commit 3a7f9c." |

### User-facing display rules (LOCKED)

**Display BOTH the composite AND the four categories** (like a credit score — one headline number, factors underneath). Example layout:

- Human Conception Strength: 73% (Contributes 50% to your Patentability Score)
- Problem Framing Evidence: 85%  (progress bar, 8 of 10 filled)
- Constraint Documentation: 70%  (progress bar, 7 of 10 filled)
- Conception Moment Evidence: 50%  (progress bar, 5 of 10 filled)
- Decision Record: 90%  (progress bar, 9 of 10 filled)

**DO display:**
- The four category percentages separately with progress bars
- The composite Human Conception Strength score
- Per-claim granularity (different claims can have different category scores)
- Category-specific guidance on how to strengthen the weakest area
- **Color-coded score bands** to indicate strength at a glance:
  - **Red** (0-24%): "Considerable work needed in this area" — signals urgency, NOT failure. Coaching language around the red score guides the user to the specific action that will raise it.
  - **Amber** (25-49%): "Building"
  - **Blue** (50-74%): "Solid — room to strengthen"
  - **Green** (75-100%): "Strong documentation"

**Do NOT display anywhere:**
- "% human vs. % AI" (misleading — implies a threshold that doesn't exist in law)
- "You need X% to file"
- "Your contribution is only N% so you might not qualify"
- A single "human contribution percentage" without the four-category breakdown
- Words like "failing," "fail," "wrong," "bad," "insufficient" in ANY score-related copy (regardless of color)

**Critical nuance on color use:**
Red indicates that a category has **considerable work to do**, not that the user has failed. The positive-coaching tone is maintained through *language*, not through avoiding the color red. For example:
- GOOD: "Problem Framing: 18% — this is where your biggest opportunity sits. Adding a pre-AI journal entry describing the problem would significantly strengthen this area."
- BAD: "Problem Framing: 18% FAIL"

Color is a glance-level signal. The surrounding copy is where coaching lives.

### Required user-facing explanation (help text — LOCKED)

Every screen that displays percentages must include accessible help text (tooltip, info icon, or footer block) with substantially this language:

> **What these percentages mean**
>
> Under the USPTO Revised Inventorship Guidance (November 28, 2025), AI is treated as a tool and **there is no required percentage for human contribution**. The legal test is conception — did you form "a definite and permanent idea of the complete and operative invention"?
>
> The percentages you see represent **how completely your documentation supports that conception** across four evidence categories. Higher percentages mean stronger evidence if your patent is ever challenged. Lower percentages indicate gaps to strengthen — not disqualifying deficiencies.
>
> No specific score is "passing." Your goal is to build the evidentiary record examiners and courts look for.

### Copy language patterns (LOCKED)

**Instead of:** "Your human contribution is 43%"
**Use:** "Your conception evidence shows 43% documentation completeness across four categories"

**Instead of:** "You need 80% to file"
**Use:** "Your documentation is strong in [Problem Framing, Decision Record] and could be strengthened in [Conception Moment]"

**Instead of:** "AI contribution too high — may affect patentability"
**Use:** "Your AI interaction records are thorough. To balance them, consider adding more pre-AI documentation showing your independent problem framing."

### Live-update feedback during Q&A (LOCKED patterns)

When a user answers a Q&A question, the affected category score updates with feedback:

- **+30% or more:** "Strong specific answer — that's the evidence examiners look for."
- **+15-29%:** "Nice refinement — that adds real evidentiary weight."
- **+5-14%:** "Every bit counts. That's a step forward."
- **0%:** "Your answer didn't change the score yet, but it adds to your documentation record. Can you add a specific example or date?"
- **Negative (rare):** Never shown — if an answer reveals an issue, the feedback is neutral and forward-looking: "Thanks for the clarification. Let's explore this dimension further in the next question."

### Per-claim vs. overall scoring

The four evidence categories are scored **per claim candidate**, not just overall. A user's invention might have multiple claimed features; each feature gets its own evidence profile. The composite Human Conception Strength score shown at the top is an average weighted by claim importance.

Example:
- Feature 1 (primary claim): 82% Human Conception Strength
- Feature 2 (secondary claim): 60% Human Conception Strength
- Feature 3 (dependent claim): 75% Human Conception Strength
- **Overall composite: 72%** (weighted by primary-claim importance)

Users can click into each feature to see the four category breakdowns for that specific claim.

### User-facing copy patterns

**When strong profile is detected:**
> *Your contribution profile indicates strong human conception. You framed the problem before using AI, set specific technical constraints, and documented your decision to modify the AI's suggestions. This is the pattern examiners look for under the 2025 USPTO guidance.*

**When weaker profile is detected:**
> *Your contribution profile suggests AI played the larger conceptual role. To strengthen patentability under the 2025 USPTO guidance, consider documenting: [specific suggestions based on which of the 4 categories are weak].*

### Prior-project inventorship materials — CURRENT (no updates needed)

The following files from the April 19 project bundle WERE updated on April 12, 2026 to reflect the November 2025 revised guidance. They are current and can be referenced directly as product deliverables or sample outputs:
- `AI_Patentability_Good_Hygiene_Guide.docx` — explicitly cites USPTO Revised Guidance (Nov 28, 2025)
- `AI_Patentability_IDF_Template.docx` — uses the 4-category framework per current guidance
- `AI_Patentability_Inventor_Interview_Checklist.docx` — Parts I-IV match current guidance
- `AI_Patentability_Disclosure_IDF-2026-0042.docx` — example using 50/35/15 scoring formula

### Sources for this standard

- USPTO Revised Inventorship Guidance for AI-Assisted Inventions (Federal Register, November 28, 2025, 90 Fed. Reg. 54636, Docket No. PTO-P-2025-0014)
- Thaler v. Vidal, 43 F.4th 1207 (Fed. Cir. 2022), cert. denied, 143 S. Ct. 1783 (2023) — AI cannot be an inventor
- Executive Order 14179 (January 23, 2025) — "Removing Barriers to American Leadership in Artificial Intelligence"
- Recentive Analytics, Inc. v. Fox Corp., 134 F.4th 1205 (Fed. Cir. 2025) — applying generic ML to new data environment is §101 ineligible
- Rensselaer Polytechnic Institute v. Amazon.com, Inc., No. 2023-2008 (Fed. Cir. Feb. 24, 2026) — extended Recentive to NLP claims
- Pannu v. Iolab Corp., 155 F.3d 1344 (Fed. Cir. 1998) — joint inventorship test (no longer controlling for single-human AI-assisted inventions)

---

*End of ENGINE_STATE.md. See PROJECT_STATE.md for the index.*
