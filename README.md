# Patent PreCheck

AI patentability platform for developers. Scores uploaded code against the three statutory requirements for patentability (novelty, non-obviousness, utility) plus §101 eligibility and §112 filing readiness. Updated daily against current US patent law.

## Repo layout

```
apps/
  website/              # 9 HTML pages — deployed to Netlify
backend/
  patentability/        # v1 engine (this is the active build area)
  legal-intel/          # existing legal change monitoring
  shared/               # shared utilities (embeddings, DB, etc.)
handoff/                # previous session artifacts — read-only reference
infra/
  docker/               # docker-compose for local pgvector
  migrations/           # SQL migrations
```

## Status

| Component | State |
|---|---|
| Website | Deployed at `patentprecheck-1776362495343.netlify.app` |
| Patentability engine v1 | Scaffolded in `backend/patentability/`, awaiting ingestion pipeline |
| Legal intelligence backend | Written in `backend/legal-intel/`, not yet deployed to Replit |
| Chrome extension | Zipped in `handoff/05-chrome-extension.zip`, awaiting Web Store |
| Copyright registration | Filed — Case #1-15142210311 (April 14, 2026) |

## Quick start for the next work session

If you are Claude Code picking this up:

1. Read `CLAUDE_CODE_BRIEF.md` in the repo root — this is the full Phase 2 brief.
2. Read `backend/patentability/README.md` for engine architecture.
3. Do not begin implementation until Kevin confirms the Phase 2.1 plan.

If you are Kevin and just want to redeploy the website:

1. Zip the contents of `apps/website/` (not the folder itself).
2. Drag onto Netlify at `app.netlify.com`.

## Critical design decisions (locked)

- **Pillar weights:** §101 Eligibility 25%, §102 Novelty 25%, §103 Non-Obviousness 30%, §101 Utility 10%, §112 Filing Readiness 10%
- **Band rules:** File Ready requires ALL patentability pillars ≥ 70 and weighted score ≥ 80
- **Free sources only in v1.** Tier H commercial databases disabled.
- **LLM:** Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **Tone:** supportive coach; never "problem" or "wrong"
- **Source list is proprietary** — never published in website copy

## License

All rights reserved. Proprietary — Kevin J. Berk, 2026.
