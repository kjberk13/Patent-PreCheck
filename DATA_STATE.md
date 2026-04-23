# DATA_STATE.md — Patent PreCheck Current Data Corpus

**Scope:** What documents are currently ingested. Updates as corpus grows.
**Parent:** `PROJECT_STATE.md` (index)

---

## Current Corpus

**Total documents in Neon: 16,030**

| Source | Count | Notes |
|---|---|---|
| USPTO utility patents | 15,000 | 2015-onwards, CPC classes G06F, G06N, G06Q, H04L |
| GitHub repositories | 1,029 | READMEs embedded, mostly software projects |
| arXiv papers | 1 | Delta-only; backfill pending |

## Backfill Status

- ✅ **USPTO:** complete (15K smoke backfill achieved 2026-04-21)
- ⏳ **arXiv:** pending — operator task, set `INGEST_MODE=backfill` + `INGEST_LIMIT=8000` + `INGEST_SOURCE=arxiv` in Railway, wait 45-60 min. See INFRA_STATE.md for env var details.
- ❌ **USPTO office actions / rejected applications:** not yet ingested (Phase 3 scope — see FEATURES_STATE.md)

## Budget per 15K run
- Voyage embeddings: ~$2-3 (inside 200M free token allowance)
- Neon writes: negligible
- Runtime: 60-90 minutes

---

*End of DATA_STATE.md. See PROJECT_STATE.md for the index.*
