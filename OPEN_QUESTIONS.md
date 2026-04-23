# OPEN_QUESTIONS.md — Patent PreCheck Known Conflicts & Pending Decisions

**Scope:** Resolved decisions (with dates) and remaining open questions.
**Parent:** `PROJECT_STATE.md` (index)

---

## Resolved Decisions

### 2026-04-21
- ✅ **Pricing:** $69.95 (supersedes prior locked $69.99)
- ✅ **Input storage:** hash-only (not raw content — honors "no code content stored" policy)
- ✅ **Interactive Code Review design:** wireframe as inspiration, can deviate

### 2026-04-22
- ✅ **Scoring methodology:** 50/35/15 weighted composite (Human Conception Strength / §101 Technical Specificity / Documentation Quality). See ENGINE_STATE.md.
- ✅ **Display model:** Composite score + four evidence categories (like a credit score). Color-coded bands including red for "considerable work needed."
- ✅ **Evidence upload policy:** Option C — never store originals, only extracted structured evidence. See FEATURES_STATE.md.
- ✅ **Paid tier output:** TWO deliverables — IDF + filing-ready patent application draft.
- ✅ **Daily legal intelligence scope:** Tier 1 + Tier 2 only (~50 free sources). Tier 3 premium deferred to Phase 4.
- ✅ **Tier 3 source cleanup:** PatSnap and Clarivate Derwent REMOVED from registry (duplicative of USPTO ODP). Only Lexis+ AI and Westlaw Precision remain as Phase 4 candidates.
- ✅ **Phase 5 expansion:** Copyright-assisted filing first (~$199), then patent-assisted filing (~$499 provisional).

---

## Open Questions

### Trademark & branding
- Does "AI Patentability Algorithm" remain a trademark candidate alongside "Patent PreCheck"? Or consolidate to single mark?

### Live site reconciliation
- Color palette: does the live site match the locked values (`#0C2340`, `#0C447C`, `#1D9E75`)? Need to audit.
- Fonts: live site uses DM Serif Display for some headlines; locked value is Playfair Display. Confirm.

### Engine & UX
- Phase 3 rejection analysis: surface to user as a separate section, or weave into existing §102/§103 scoring?
- Where does the legal intelligence database live — same Neon instance or separate? (Likely same Neon, new schema for unified querying)
- How does the engine incorporate legal updates into scoring — retraining, prompt injection with recent cases, or hybrid? (Likely prompt injection with structured doctrinal summary for first iteration)
- Re-review trigger thresholds — what counts as a "material" shift worth notifying users about?

### Marketing copy
- **57% Section 101 failure stat** — verify source in the April 15 competitive analysis before using in public marketing copy. If it traces to a credible citation, it's a powerful hook. If it's uncited speculation, don't use it.

### Infrastructure
- Domain migration timing: patentprecheck.com → Netlify (needed for proper Resend email sending domain, Chrome Web Store submission, trademark filing citation).

---

*End of OPEN_QUESTIONS.md. See PROJECT_STATE.md for the index.*
