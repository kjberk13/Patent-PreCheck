# DESIGN.md — Patent PreCheck Design System & Copy Patterns

**Scope:** Color tokens, typography, spacing, layout, components, accessibility, animation, logo, trademark treatment, iconography, voice, copy patterns.
**Parent:** `PROJECT_STATE.md` (index)

---

## Design System

### Color Tokens (LOCKED)

**Primary palette:**
- `--color-navy: #0C2340` — primary brand color, used for hero backgrounds, nav bar, primary buttons
- `--color-blue: #0C447C` — secondary brand color, used for links, hover states, secondary emphasis
- `--color-green: #1D9E75` — accent color, used for success states, positive framing, "Opportunity" indicators, score ring at high band

**Neutral palette:**
- `--color-bg-light: #F4F7FF` — light section backgrounds (stats band, alt rows)
- `--color-bg-card: #FFFFFF` — card backgrounds
- `--color-border-subtle: #E2E8F4` — subtle borders, dividers
- `--color-text-primary: #0C2340` — primary body text (same as navy)
- `--color-text-secondary: #4A5568` — secondary body text, captions
- `--color-text-muted: #718096` — muted text, footnotes, metadata

**Score band colors (for traffic light scoring):**
- `--score-red: #E53E3E` — 0–24, "Considerable work needed"
- `--score-amber: #DD6B20` — 25–49, "Building"
- `--score-blue: #0C447C` — 50–74, "Solid — room to strengthen"
- `--score-green: #1D9E75` — 75–100, "Strong documentation"

**Live site audit item:** current `analyze.html` and `index.html` may use slightly different hex values. Reconcile on next style pass.

### Typography (LOCKED)

**Font families:**
- **Display (headings h1–h2):** Playfair Display, serif fallback
- **Subheads (h3–h4):** DM Sans, semibold weight
- **Body:** DM Sans, regular weight
- **Monospace (code blocks, textareas):** system monospace stack (`SF Mono, Menlo, Monaco, Consolas, monospace`)

**Live site audit item:** some headlines use DM Serif Display — reconcile to Playfair Display on next style pass.

**Font sizes (modular scale, base 16px):**
| Token | Size | Usage |
|---|---|---|
| `--font-xs` | 12px | Footnotes, metadata |
| `--font-sm` | 14px | Captions, UI labels |
| `--font-base` | 16px | Body copy |
| `--font-md` | 18px | Large body copy, lead paragraphs |
| `--font-lg` | 24px | h4 |
| `--font-xl` | 32px | h3 |
| `--font-2xl` | 48px | h2 |
| `--font-3xl` | 64px | h1 / hero headline |

**Line height:** 1.6 for body, 1.2 for headlines.

**Font weights:** Playfair Display 400 (regular), 700 (bold). DM Sans 400 (regular), 500 (medium), 600 (semibold), 700 (bold).

### Spacing Scale (LOCKED)

Built on a 4px base unit:
| Token | Pixels | Usage |
|---|---|---|
| `--space-1` | 4px | Tightest inline spacing |
| `--space-2` | 8px | Small gaps between related elements |
| `--space-3` | 12px | Form field padding |
| `--space-4` | 16px | Default element spacing |
| `--space-6` | 24px | Card padding |
| `--space-8` | 32px | Section padding (small) |
| `--space-12` | 48px | Section padding (default) |
| `--space-16` | 64px | Section padding (large / hero) |
| `--space-24` | 96px | Max section padding (hero top/bottom on desktop) |

### Layout Tokens

**Container widths:**
- `--container-sm: 640px` — narrow content (policies, long-form reading)
- `--container-md: 960px` — default content container
- `--container-lg: 1200px` — wide content container
- `--container-xl: 1440px` — hero and feature sections

**Border radius:**
- `--radius-sm: 4px` — small inputs
- `--radius-md: 8px` — default for cards, buttons
- `--radius-lg: 12px` — large cards, hero elements
- `--radius-pill: 999px` — pills, badges, score rings

**Shadows:**
- `--shadow-sm: 0 1px 2px rgba(12, 35, 64, 0.05)` — subtle elevation
- `--shadow-md: 0 4px 12px rgba(12, 35, 64, 0.08)` — cards
- `--shadow-lg: 0 12px 32px rgba(12, 35, 64, 0.12)` — modals, elevated elements

### Component Patterns

**Buttons:**
- **Primary (`.btn-primary`):** Navy background, white text, padding 12px 24px, radius-md, DM Sans semibold 14–16px
- **Secondary (`.btn-secondary`):** White background, navy border, navy text, same padding
- **Accent CTA (`.btn-g`):** Green background, white text (used for major CTAs like "Run a free Patent PreCheck")
- **Disabled state:** 45% opacity, cursor not-allowed, no hover effect
- **Hover state:** subtle brightness shift (5–10%), no size change
- **Focus state:** 2px green outline, offset 2px (accessibility requirement)

**Cards:**
- White background, border-subtle 1px, radius-md, shadow-sm
- Padding space-6 default
- Hover state: shadow-md (for interactive cards only)

**Inputs:**
- 12px 16px padding, radius-md, border-subtle 1px
- Focus state: blue border, no outline shift
- Monospace font for code-related inputs
- Placeholder color: text-muted

**Score rings:**
- Circular SVG with stroke thickness 4–6px
- Ring color matches score band
- Large numeric score centered inside
- Small label (e.g., "PATENTABILITY") above the number

**Stats band (homepage flagship section):**
- 4-column grid on desktop, 2×2 on mobile
- Icon + title + caption layout per cell
- Icons: line weight 1.6, 24–32px size, accent green stroke
- Background: bg-light with subtle border

### Mobile / Responsive (LOCKED)

**Breakpoints:**
- **Desktop:** ≥ 768px (default layout)
- **Tablet/Mobile:** < 768px (first breakpoint — hamburger nav appears)
- **Narrow mobile:** < 480px (second breakpoint — further compaction)

**Mobile rules:**
- Hamburger menu with slide-down panel (implemented in `nav.js`)
- Touch targets ≥ 44px minimum (WCAG AA requirement)
- Grids collapse: 4-col → 2×2 at 768px, then to 1-col at 480px
- Font sizes scale down slightly (not aggressively)
- Section padding compresses: space-12 → space-8 at 768px
- Nav auto-closes on link click or window resize

### Accessibility (LOCKED)

**Baseline: WCAG AA compliance.**
- Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text
- Focus states visible on all interactive elements (no `outline: none` without replacement)
- All interactive elements keyboard-accessible
- Form inputs have associated labels (either visible or aria-label)
- Images have alt text or marked decorative (`role="presentation"`)
- Skip-to-content link in nav (for screen readers)
- Semantic HTML (`<main>`, `<section>`, `<nav>`, `<article>`)
- Heading hierarchy maintained (no skipping h1 → h3)

**Touch accessibility:**
- Touch targets ≥ 44×44px (iOS minimum, WCAG AA)
- Spacing between adjacent touch targets ≥ 8px

### Animation Principles (LOCKED)

**When to animate:**
- On page load: one-shot brand reveal (e.g., logo checkmark draw-in, first 1–2s)
- On hover/focus: subtle state transitions (200ms max)
- On score updates: smooth number counter (300–500ms), color band transitions
- On issue completion (Interactive Code Review): celebratory but subtle (checkmark + color shift)

**When NOT to animate:**
- Continuous background motion (distracts from content)
- Scroll-triggered parallax effects (performance + accessibility concerns)
- Bounce/wobble interactions (undermines coaching tone)

**prefers-reduced-motion:**
- All animations MUST respect `@media (prefers-reduced-motion: reduce)`
- When reduced motion is preferred: disable draw-in animations, keep score updates instant, no transitions on hover
- Implementation: wrap all animation CSS in the media query with override rules

**Timing:**
- Fast interactions (hover, focus): 150–200ms
- State changes (score updates, tab switches): 300–400ms
- Page-load reveals: 600–1200ms (single burst, not continuous)
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (standard ease-out)

### Logo (LOCKED)

**Canonical renderer:** `nav.js` — use for every page's nav + footer

**Composition:**
- Brain outline (neural network / neurons) as subtle background
- Three green checkmark nodes that fade in with stagger (0.15s / 0.30s / 0.45s)
- Two checkmark strokes that draw in via stroke-dasharray (0.65s / 1.05s)
- "Patent PreCheck™" wordmark to the right of the mark
- ™ as superscript immediately after "Check"

**Variants:**
- Horizontal (default, for nav)
- Stacked (for hero, footer, square placements)
- Light backgrounds: navy + green + white brain
- Dark backgrounds: white + green + lighter brain
- Formats: SVG (primary), PNG (fallback), JPG (email signatures)

**Known improvement item (backlog — Phase 2.8):**
Brighten the brain outline from ~32% to 60–75% white opacity for better contrast, especially at small sizes. Currently reads as faint texture rather than branded mark.

### Trademark Treatment (LOCKED as of 2026-04-21)

- **Logo:** ™ as superscript immediately after "Check" in the wordmark
- **First body mention per page:** append ™ to "Patent PreCheck"
- **Footer copyright line:** "© 2026 Patent PreCheck™. All rights reserved."
- **Do NOT** put ™ on every mention (reads cluttered)

### Iconography

**Library:** Lucide Icons (preferred) or hand-crafted SVGs for brand-specific icons (logo mark itself).

**Style:**
- Line weight: 1.6 (consistent across all icons)
- Stroke: current color (inherit from parent)
- Size: 24px default, 32px for stats band / feature emphasis, 16px for inline text
- Color: accent green for positive/feature icons, navy for structural icons, text-secondary for informational

**Reserved usage:**
- Checkmark: only for positive completion ("issue resolved," "claim strengthened")
- Arrow up: "↑ Opportunity" indicator (per coaching tone requirement)
- Shield: security/trust signals
- Lightning bolt: speed/performance signals
- Database/globe: data/corpus signals
- Refresh: currency/freshness signals

### Voice and Coaching Tone (Design-Adjacent, LOCKED)

Every UI element reinforces positive coaching:
- Progress indicators show forward motion, not "how far you have to go"
- Error states framed as "Let's try that again" not "Invalid input"
- Empty states celebrate potential ("Ready when you are") not absence ("Nothing here")
- Score movements celebrated even if small ("+3 — nice refinement")
- Never use: red X icons, the words "failed," "wrong," "error" without softer framing

This is a design and copy rule, enforced across all components.

**Important nuance on colors:** Red as a score-band color is acceptable — it signals "considerable work needed," not failure. The positive-coaching tone comes from surrounding language, not from avoiding the color red. See ENGINE_STATE.md for full color-usage rules.

---

## Copy Patterns

### Homepage headline (current live)
"Is your idea patentable? Is it ready to file?"

### Homepage hero subhead (current live)
"Two scores in 60 seconds. Know exactly where you stand and what to strengthen — without an attorney."

### Alternative positioning (from competitive analysis) — consider for A/B testing
"Did you use AI to build it? Find out if you can still patent it."

This is the sharpest positioning identified in the competitive analysis (April 15, 2026 doc). It:
- Targets a specific audience (developers using AI)
- Raises a specific anxiety (AI-assisted work's patentability is genuinely uncertain under USPTO 2025 guidance)
- Promises a specific answer
- Differentiates from every attorney-facing tool in the market

Not currently live. Could replace or complement the current headline, or appear as a secondary positioning in different contexts (ad copy, landing pages, social).

### Cost-of-attorney framing (from competitive analysis)
A typical patentability opinion from a patent attorney costs **$15,000–$25,000**. Patent PreCheck at $69.95 is positioned as the triage layer before that spend. Copy variants:
- "Before you spend $15K on a patent attorney, spend 60 seconds here."
- "Know before you spend thousands: is your invention patentable?"
- "The smart pre-attorney step — for the cost of a streaming subscription."

### The Section 101 failure stat
"57% of AI-assisted applications fail Section 101" appears in the competitive analysis. Before using this in public marketing, **verify source** — if it traces to a credible citation (e.g., USPTO statistical report, law firm study), it's a powerful hook. If it's uncited speculation, don't use it.

### Homepage flagship section (shipped 2026-04-21)
"Trained on thousands of real patent filings. Updated daily."
- Four-icon stats band: Comprehensive / Always current / Authoritative / Fast (qualitative, no specific numbers)
- Attorney-acknowledgment paragraph
- CTA: "Run a free Patent PreCheck →" with subtext "See your free patentability score in 60 seconds."

### CTA conventions
- Free entry: "Run a free Patent PreCheck" or "See your free patentability score"
- Paid upgrade: "Upgrade to Interactive Code Review"

### What never goes public (LOCKED)
- Source list, feed counts, algorithm internals
- Risk flag taxonomy
- That underlying analysis uses an LLM
- Any specific numbers about corpus size (use qualitative claims only)
- Specific weights in the scoring formula (50/35/15 is internal, not marketing)

Public copy leads with outcomes (score, monitoring, record) — never methods.

---

*End of DESIGN.md. See PROJECT_STATE.md for the index.*
