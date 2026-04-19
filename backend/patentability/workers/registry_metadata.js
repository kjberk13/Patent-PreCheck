'use strict';

// =====================================================================
// Worker registry metadata.
//
// Lambda-safe: this module imports NO worker classes, so the Netlify
// function bundle stays small and does not pull in pg / base_worker /
// the rest of the ingestion-side code.
//
// Shape of each entry:
//   { id, tier, priority, status }
//     status: 'implemented' | 'planned'
//
// The full registry (backend/patentability/workers/registry.js) adds a
// `.worker` class binding for each implemented source. Use the full
// registry in the CLI or anywhere that needs to instantiate workers.
// =====================================================================

const STATUS_IMPLEMENTED = 'implemented';
const STATUS_PLANNED = 'planned';

// id, tier, priority, status
const METADATA = [
  // Tier A — patents
  ['uspto-patentsview', 'A', 'CRITICAL', STATUS_IMPLEMENTED],
  ['uspto-peds', 'A', 'CRITICAL', STATUS_PLANNED],
  ['uspto-bulk-google', 'A', 'CRITICAL', STATUS_PLANNED],
  ['google-patents-api', 'A', 'HIGH', STATUS_PLANNED],
  ['epo-ops', 'A', 'HIGH', STATUS_PLANNED],
  ['wipo-patentscope', 'A', 'HIGH', STATUS_PLANNED],
  ['espacenet', 'A', 'HIGH', STATUS_PLANNED],
  ['lens-patents', 'A', 'HIGH', STATUS_PLANNED],
  ['jpo-jplatpat', 'A', 'MEDIUM', STATUS_PLANNED],
  ['kipris', 'A', 'MEDIUM', STATUS_PLANNED],
  ['cnipa-search', 'A', 'MEDIUM', STATUS_PLANNED],
  ['dpma-depatisnet', 'A', 'LOW', STATUS_PLANNED],
  ['cipo-canadian', 'A', 'LOW', STATUS_PLANNED],
  ['ipa-auspat', 'A', 'LOW', STATUS_PLANNED],
  // Tier B — academic
  ['arxiv', 'B', 'CRITICAL', STATUS_IMPLEMENTED],
  ['semantic-scholar', 'B', 'CRITICAL', STATUS_PLANNED],
  ['openalex', 'B', 'HIGH', STATUS_PLANNED],
  ['crossref', 'B', 'HIGH', STATUS_PLANNED],
  ['core-ac', 'B', 'MEDIUM', STATUS_PLANNED],
  ['base-search', 'B', 'MEDIUM', STATUS_PLANNED],
  ['dblp', 'B', 'HIGH', STATUS_PLANNED],
  ['ieee-xplore', 'B', 'HIGH', STATUS_PLANNED],
  ['acm-dl', 'B', 'MEDIUM', STATUS_PLANNED],
  ['ssrn', 'B', 'LOW', STATUS_PLANNED],
  ['pubmed', 'B', 'MEDIUM', STATUS_PLANNED],
  // Tier C — open-source code
  ['github-search', 'C', 'CRITICAL', STATUS_IMPLEMENTED],
  ['gitlab-search', 'C', 'MEDIUM', STATUS_PLANNED],
  ['sourcegraph', 'C', 'HIGH', STATUS_PLANNED],
  ['stackoverflow', 'C', 'MEDIUM', STATUS_PLANNED],
  ['hackernews', 'C', 'MEDIUM', STATUS_PLANNED],
  ['producthunt', 'C', 'LOW', STATUS_PLANNED],
  ['software-heritage', 'C', 'HIGH', STATUS_PLANNED],
  ['npm-registry', 'C', 'MEDIUM', STATUS_PLANNED],
  ['pypi', 'C', 'MEDIUM', STATUS_PLANNED],
  ['crates-io', 'C', 'LOW', STATUS_PLANNED],
  ['docker-hub', 'C', 'LOW', STATUS_PLANNED],
  ['rfc-editor', 'C', 'HIGH', STATUS_PLANNED],
  // Tier D — defensive publications
  ['tdcommons', 'D', 'HIGH', STATUS_PLANNED],
  ['ibm-tdb', 'D', 'MEDIUM', STATUS_PLANNED],
  // Tier E — USPTO examination
  ['uspto-office-actions', 'E', 'CRITICAL', STATUS_PLANNED],
  ['uspto-ptab', 'E', 'CRITICAL', STATUS_PLANNED],
  ['uspto-pair', 'E', 'HIGH', STATUS_PLANNED],
  ['uspto-bdss', 'E', 'HIGH', STATUS_PLANNED],
  ['mpep', 'E', 'CRITICAL', STATUS_PLANNED],
  ['uspto-cpc', 'E', 'HIGH', STATUS_PLANNED],
  ['uspto-art-unit-stats', 'E', 'HIGH', STATUS_PLANNED],
  // Tier F — standards
  ['w3c-specs', 'F', 'MEDIUM', STATUS_PLANNED],
  ['ietf-rfcs', 'F', 'HIGH', STATUS_PLANNED],
  ['nist-pubs', 'F', 'MEDIUM', STATUS_PLANNED],
  // Tier G — ML research
  ['papers-with-code', 'G', 'CRITICAL', STATUS_PLANNED],
  ['huggingface-hub', 'G', 'HIGH', STATUS_PLANNED],
  ['openreview', 'G', 'HIGH', STATUS_PLANNED],
  ['google-ai-research', 'G', 'MEDIUM', STATUS_PLANNED],
  ['meta-ai-research', 'G', 'MEDIUM', STATUS_PLANNED],
  ['microsoft-research', 'G', 'MEDIUM', STATUS_PLANNED],
  ['deepmind-pubs', 'G', 'MEDIUM', STATUS_PLANNED],
  ['anthropic-research', 'G', 'MEDIUM', STATUS_PLANNED],
  ['openai-research', 'G', 'MEDIUM', STATUS_PLANNED],
];

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const metadataById = new Map();
for (const [id, tier, priority, status] of METADATA) {
  metadataById.set(id, { id, tier, priority, status });
}

function getEntry(id) {
  return metadataById.get(id) || null;
}

function listAll() {
  return [...metadataById.values()];
}

function listImplemented() {
  return listAll().filter((e) => e.status === STATUS_IMPLEMENTED);
}

function listByPriority(priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  const set = new Set(priorities);
  return listAll()
    .filter((e) => set.has(e.priority))
    .sort(
      (a, b) =>
        (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99) ||
        a.tier.localeCompare(b.tier) ||
        a.id.localeCompare(b.id),
    );
}

module.exports = {
  getEntry,
  listAll,
  listImplemented,
  listByPriority,
  STATUS_IMPLEMENTED,
  STATUS_PLANNED,
};
