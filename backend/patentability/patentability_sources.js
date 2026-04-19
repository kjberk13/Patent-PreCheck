// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Patentability Assessment Source Registry v1.0
// Prior art and patentability reference corpus feeding the three-pillar algorithm:
//   1. Novelty (§102)       — Is this new?
//   2. Non-Obviousness (§103) — Is this inventive?
//   3. Utility (§101 utility prong) — Does it work and matter?
// Plus the §101 eligibility filter (Alice/Mayo) which is scored separately.
//
// Free sources only in v1. Premium sources (Tier H) commented out for Phase 2.
// Source list is PROPRIETARY — never published externally.
// ─────────────────────────────────────────────────────────────────────────────

const PATENTABILITY_SOURCES = [

  // ══════════════════════════════════════════════════════════════════════════
  // TIER A — PATENT & PUBLISHED APPLICATION DATABASES (primary prior art)
  // Core §102/§103 corpus. These are the documents examiners cite most.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'uspto-patentsview',  name:'USPTO PatentsView API',               url:'https://search.patentsview.org/api/v1/',                                    type:'api',  tier:'A', priority:'CRITICAL', coverage:['US'],          pillars:['novelty','non_obvious'], docType:'patent',            auth:'none',                note:'11M+ US granted patents and applications, full-text searchable' },
  { id:'uspto-peds',         name:'USPTO Patent Examination Data (PEDS)', url:'https://ped.uspto.gov/api/queries',                                         type:'api',  tier:'A', priority:'CRITICAL', coverage:['US'],          pillars:['non_obvious','eligibility'], docType:'prosecution',    auth:'none',                note:'Complete examination history — office actions, final dispositions' },
  { id:'uspto-bulk-google',  name:'Google Patents Public Datasets (BigQuery)', url:'https://console.cloud.google.com/bigquery?p=patents-public-data',    type:'bigquery', tier:'A', priority:'CRITICAL', coverage:['US','EP','WIPO','CN','JP','KR'], pillars:['novelty','non_obvious'], docType:'patent', auth:'gcp-free-tier', note:'120M+ global patents full-text, free up to 1TB/mo query' },
  { id:'google-patents-api', name:'Google Patents Search API',           url:'https://patents.google.com/xhr/query',                                       type:'scrape', tier:'A', priority:'HIGH',    coverage:['US','EP','WIPO','CN','JP','KR','DE','FR','GB'], pillars:['novelty','non_obvious'], docType:'patent', auth:'none',     note:'Frontend API, rate-limited, excellent relevance' },
  { id:'epo-ops',            name:'EPO Open Patent Services (OPS)',      url:'https://ops.epo.org/3.2/rest-services',                                      type:'api',  tier:'A', priority:'HIGH',     coverage:['EP'],          pillars:['novelty','non_obvious'], docType:'patent',            auth:'oauth-free',          note:'European Patent Office full-text and register, 4GB/week free' },
  { id:'wipo-patentscope',   name:'WIPO PATENTSCOPE',                    url:'https://patentscope.wipo.int/search/en/structuredSearch.jsf',                type:'scrape', tier:'A', priority:'HIGH',   coverage:['WIPO'],        pillars:['novelty'],               docType:'patent',            auth:'none',                note:'100M+ international PCT applications, full-text' },
  { id:'espacenet',          name:'Espacenet — European Patent Database', url:'https://worldwide.espacenet.com/',                                          type:'scrape', tier:'A', priority:'HIGH',   coverage:['EP','WIPO','multinational'], pillars:['novelty'], docType:'patent',                    auth:'none',                note:'Free full-text European and international patents' },
  { id:'lens-patents',       name:'The Lens.org Patent API',             url:'https://api.lens.org/patent/search',                                         type:'api',  tier:'A', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'patent',            auth:'api-key-free-tier',   note:'140M+ patents linked to scholarly work — strong non-obviousness signal' },
  { id:'jpo-jplatpat',       name:'JPO J-PlatPat',                       url:'https://www.j-platpat.inpit.go.jp/api/',                                     type:'scrape', tier:'A', priority:'MEDIUM', coverage:['JP'],          pillars:['novelty'],               docType:'patent',            auth:'none',                note:'Japanese patents — critical AI/electronics prior art' },
  { id:'kipris',             name:'KIPRIS Korean Patents',               url:'http://plus.kipris.or.kr/openapi/',                                           type:'api',  tier:'A', priority:'MEDIUM',   coverage:['KR'],          pillars:['novelty'],               docType:'patent',            auth:'api-key-free',        note:'Korean Intellectual Property Rights Information Service' },
  { id:'cnipa-search',       name:'CNIPA China Patent Search',           url:'https://pss-system.cponline.cnipa.gov.cn/',                                   type:'scrape', tier:'A', priority:'MEDIUM', coverage:['CN'],          pillars:['novelty'],               docType:'patent',            auth:'none',                note:'Chinese patents — increasingly cited prior art' },
  { id:'dpma-depatisnet',    name:'DPMA DEPATISnet',                     url:'https://depatisnet.dpma.de/DepatisNet/depatisnet',                            type:'scrape', tier:'A', priority:'LOW',    coverage:['DE'],          pillars:['novelty'],               docType:'patent',            auth:'none',                note:'German national patent database' },
  { id:'cipo-canadian',      name:'CIPO Canadian Patents Database',      url:'https://ised-isde.canada.ca/cipo/opic/cpd/eng/search/',                       type:'scrape', tier:'A', priority:'LOW',    coverage:['CA'],          pillars:['novelty'],               docType:'patent',            auth:'none',                note:'Canadian patents and applications' },
  { id:'ipa-auspat',         name:'IP Australia AusPat',                 url:'http://pericles.ipaustralia.gov.au/ols/auspat/',                              type:'scrape', tier:'A', priority:'LOW',    coverage:['AU'],          pillars:['novelty'],               docType:'patent',            auth:'none',                note:'Australian patent database' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER B — ACADEMIC & TECHNICAL LITERATURE
  // Non-patent prior art. Every published paper counts under §102.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'arxiv',              name:'arXiv API',                           url:'https://export.arxiv.org/api/query',                                          type:'api',  tier:'B', priority:'CRITICAL', coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'none',                note:'Preprint server — where most ML/CS research appears first' },
  { id:'semantic-scholar',   name:'Semantic Scholar API',                url:'https://api.semanticscholar.org/graph/v1/',                                   type:'api',  tier:'B', priority:'CRITICAL', coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'api-key-free',        note:'200M+ papers with citation graph, excellent relevance' },
  { id:'openalex',           name:'OpenAlex',                            url:'https://api.openalex.org/',                                                   type:'api',  tier:'B', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'none',                note:'240M+ scholarly works, replacement for MS Academic Graph' },
  { id:'crossref',           name:'Crossref API',                        url:'https://api.crossref.org/works',                                              type:'api',  tier:'B', priority:'HIGH',     coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:'Metadata for 130M+ scholarly works across publishers' },
  { id:'core-ac',            name:'CORE.ac.uk API',                      url:'https://api.core.ac.uk/v3/',                                                  type:'api',  tier:'B', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'api-key-free',        note:'200M+ open-access papers, full-text for many' },
  { id:'base-search',        name:'BASE Bielefeld Academic Search',      url:'https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi',            type:'api',  tier:'B', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'ip-whitelist',        note:'300M+ docs from open-access repositories' },
  { id:'dblp',               name:'DBLP Computer Science Bibliography',  url:'https://dblp.org/search/publ/api',                                            type:'api',  tier:'B', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'none',                note:'6M+ CS publications, essential for software patents' },
  { id:'ieee-xplore',        name:'IEEE Xplore Metadata API',            url:'https://developer.ieee.org/io-docs',                                          type:'api',  tier:'B', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'api-key-free',        note:'Engineering and CS papers, metadata free' },
  { id:'acm-dl',             name:'ACM Digital Library (metadata)',      url:'https://dl.acm.org/',                                                          type:'scrape', tier:'B', priority:'MEDIUM', coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'none',                note:'Computer science literature, free metadata' },
  { id:'ssrn',               name:'SSRN Working Papers',                 url:'https://www.ssrn.com/',                                                       type:'scrape', tier:'B', priority:'LOW',    coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:'Pre-publication research, strong for engineering/CS' },
  { id:'pubmed',             name:'PubMed / PubMed Central API',         url:'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/',                              type:'api',  tier:'B', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:'Biomedical literature — health/bio-software patents' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER C — OPEN-SOURCE CODE & TECHNICAL DISCLOSURE
  // Software-specific prior art. Public code is §102 prior art.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'github-search',      name:'GitHub Search API',                   url:'https://api.github.com/search/',                                              type:'api',  tier:'C', priority:'CRITICAL', coverage:['global'],      pillars:['novelty'],               docType:'code',              auth:'token-free',          note:'400M+ public repos, code and commit search' },
  { id:'gitlab-search',      name:'GitLab Projects API',                 url:'https://gitlab.com/api/v4/',                                                  type:'api',  tier:'C', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'code',              auth:'token-free',          note:'Complementary repository search' },
  { id:'sourcegraph',        name:'Sourcegraph Public Code Search',      url:'https://sourcegraph.com/api/',                                                type:'api',  tier:'C', priority:'HIGH',     coverage:['global'],      pillars:['novelty'],               docType:'code',              auth:'token-free',          note:'Semantic cross-repository code search' },
  { id:'stackoverflow',      name:'Stack Overflow Data Dumps',           url:'https://archive.org/details/stackexchange',                                    type:'bulk', tier:'C', priority:'MEDIUM',   coverage:['global'],      pillars:['non_obvious'],           docType:'discussion',        auth:'none',                note:'Technical Q&A, surfaces known techniques' },
  { id:'hackernews',         name:'Hacker News via Algolia',             url:'https://hn.algolia.com/api/v1/',                                              type:'api',  tier:'C', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty','non_obvious'], docType:'discussion',        auth:'none',                note:'40M+ posts, surfaces public project launches' },
  { id:'producthunt',        name:'Product Hunt API',                    url:'https://api.producthunt.com/v2/',                                              type:'api',  tier:'C', priority:'LOW',      coverage:['global'],      pillars:['novelty'],               docType:'product',           auth:'token-free',          note:'Product launches — reveals publicly-available systems' },
  { id:'software-heritage',  name:'Software Heritage Archive',           url:'https://archive.softwareheritage.org/api/1/',                                  type:'api',  tier:'C', priority:'HIGH',     coverage:['global'],      pillars:['novelty'],               docType:'code',              auth:'none',                note:'20B+ source files, explicitly positioned as prior art' },
  { id:'npm-registry',       name:'npm Registry API',                    url:'https://registry.npmjs.org/',                                                 type:'api',  tier:'C', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'package',           auth:'none',                note:'3M+ Node packages with descriptions' },
  { id:'pypi',               name:'PyPI API',                            url:'https://pypi.org/pypi/',                                                      type:'api',  tier:'C', priority:'MEDIUM',   coverage:['global'],      pillars:['novelty'],               docType:'package',           auth:'none',                note:'Python packages and descriptions' },
  { id:'crates-io',          name:'Crates.io API',                       url:'https://crates.io/api/v1/',                                                   type:'api',  tier:'C', priority:'LOW',      coverage:['global'],      pillars:['novelty'],               docType:'package',           auth:'none',                note:'Rust packages' },
  { id:'docker-hub',         name:'Docker Hub API',                      url:'https://hub.docker.com/v2/',                                                  type:'api',  tier:'C', priority:'LOW',      coverage:['global'],      pillars:['novelty'],               docType:'package',           auth:'none',                note:'Container images, reveals system architectures' },
  { id:'rfc-editor',         name:'RFC Editor Database',                 url:'https://www.rfc-editor.org/rfc-index.xml',                                    type:'xml',  tier:'C', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'standard',          auth:'none',                note:'Internet RFCs — essential for networking/protocol patents' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER D — TECHNICAL DISCLOSURE PUBLICATIONS
  // Defensive publications specifically designed as prior art.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'tdcommons',          name:'Technical Disclosure Commons',        url:'https://www.tdcommons.org/',                                                  type:'scrape', tier:'D', priority:'HIGH',   coverage:['global'],      pillars:['novelty'],               docType:'disclosure',        auth:'none',                note:'Open defensive publication archive (Google, GW Law)' },
  { id:'ibm-tdb',            name:'IBM Technical Disclosure Bulletins',  url:'https://priorart.ip.com/IPCOM/',                                              type:'scrape', tier:'D', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'disclosure',        auth:'none',                note:'Historical IBM disclosures, extensive computing coverage' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER E — USPTO EXAMINATION DATA (the examiner playbook)
  // Unique data set. Feeds the Examiner Calibration layer in Phase 2.
  // Public and free. Rarely used well by competitors.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'uspto-office-actions', name:'USPTO Office Action Dataset',       url:'https://developer.uspto.gov/api-catalog/uspto-office-action',                  type:'api',  tier:'E', priority:'CRITICAL', coverage:['US'],          pillars:['non_obvious','eligibility'], docType:'office-action',  auth:'none',                note:'Every office action issued — foundation of examiner calibration' },
  { id:'uspto-ptab',         name:'USPTO PTAB Decisions',                url:'https://developer.uspto.gov/ptab-api/',                                       type:'api',  tier:'E', priority:'CRITICAL', coverage:['US'],          pillars:['non_obvious','eligibility'], docType:'ptab',           auth:'none',                note:'PTAB decisions — shows which §101/102/103 arguments win' },
  { id:'uspto-pair',         name:'USPTO Public PAIR',                   url:'https://patentcenter.uspto.gov/',                                             type:'scrape', tier:'E', priority:'HIGH',   coverage:['US'],          pillars:['non_obvious','eligibility'], docType:'prosecution',    auth:'none',                note:'Full prosecution history per application' },
  { id:'uspto-bdss',         name:'USPTO Bulk Data Storage System',      url:'https://bulkdata.uspto.gov/',                                                 type:'bulk', tier:'E', priority:'HIGH',     coverage:['US'],          pillars:['non_obvious'],           docType:'bulk',              auth:'none',                note:'Bulk office actions, citations, interview summaries' },
  { id:'mpep',               name:'Manual of Patent Examining Procedure', url:'https://www.uspto.gov/web/offices/pac/mpep/',                                type:'scrape', tier:'E', priority:'CRITICAL', coverage:['US'],         pillars:['eligibility','non_obvious','novelty','utility'], docType:'manual', auth:'none',           note:'Examiner rulebook — defines operational meaning of statutes' },
  { id:'uspto-cpc',          name:'USPTO CPC Classification',            url:'https://www.cooperativepatentclassification.org/cpcSchemeAndDefinitions/bulk', type:'bulk', tier:'E', priority:'HIGH',     coverage:['US','EP'],     pillars:['art_unit_routing'],      docType:'classification',    auth:'none',                note:'CPC scheme — feeds art unit prediction' },
  { id:'uspto-art-unit-stats', name:'USPTO Art Unit Allowance Stats',    url:'https://www.uspto.gov/learning-and-resources/statistics',                     type:'scrape', tier:'E', priority:'HIGH',   coverage:['US'],          pillars:['art_unit_routing'],      docType:'statistics',        auth:'none',                note:'Art unit allowance rates — examiner calibration foundation' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER F — STANDARDS, SPECS, TECHNICAL DOCUMENTATION
  // Often overlooked but authoritative prior art for software.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'w3c-specs',          name:'W3C Technical Specifications',        url:'https://www.w3.org/TR/',                                                      type:'scrape', tier:'F', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'standard',          auth:'none',                note:'Web standards — essential for web-related patents' },
  { id:'ietf-rfcs',          name:'IETF RFCs',                           url:'https://datatracker.ietf.org/api/v1/',                                        type:'api',  tier:'F', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'standard',          auth:'none',                note:'Internet engineering standards' },
  { id:'nist-pubs',          name:'NIST Publications',                   url:'https://csrc.nist.gov/publications',                                          type:'scrape', tier:'F', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'standard',          auth:'none',                note:'Cryptography, security, AI standards' },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER G — AI/ML-SPECIFIC PRIOR ART (domain-critical)
  // Your target users build with AI. Heavy weight for ML-related inventions.
  // ══════════════════════════════════════════════════════════════════════════

  { id:'papers-with-code',   name:'Papers With Code API',                url:'https://paperswithcode.com/api/v1/',                                          type:'api',  tier:'G', priority:'CRITICAL', coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper-code',        auth:'none',                note:'Links ML papers to implementations — strongest AI prior art' },
  { id:'huggingface-hub',    name:'Hugging Face Hub API',                url:'https://huggingface.co/api/',                                                 type:'api',  tier:'G', priority:'HIGH',     coverage:['global'],      pillars:['novelty'],               docType:'model',             auth:'token-free',          note:'500K+ ML models and datasets with technical documentation' },
  { id:'openreview',         name:'OpenReview API',                      url:'https://api.openreview.net/',                                                 type:'api',  tier:'G', priority:'HIGH',     coverage:['global'],      pillars:['novelty','non_obvious'], docType:'paper',             auth:'none',                note:'NeurIPS, ICLR, ICML — including rejected submissions' },
  { id:'google-ai-research', name:'Google AI Publications',              url:'https://research.google/pubs/',                                               type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"Google's published research" },
  { id:'meta-ai-research',   name:'Meta AI Research',                    url:'https://ai.meta.com/research/publications/',                                  type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"Meta's published research" },
  { id:'microsoft-research', name:'Microsoft Research Publications',     url:'https://www.microsoft.com/en-us/research/publications/',                      type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"Microsoft's research output" },
  { id:'deepmind-pubs',      name:'DeepMind Publications',               url:'https://deepmind.google/research/publications/',                              type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"DeepMind's research output" },
  { id:'anthropic-research', name:'Anthropic Research',                  url:'https://www.anthropic.com/research',                                          type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"Anthropic's research output" },
  { id:'openai-research',    name:'OpenAI Research',                     url:'https://openai.com/research/',                                                type:'scrape', tier:'G', priority:'MEDIUM', coverage:['global'],      pillars:['novelty'],               docType:'paper',             auth:'none',                note:"OpenAI's research output" },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER H — COMMERCIAL PRIOR ART DATABASES (PHASE 2, PAID)
  // Enabled when revenue supports the spend. Commented out for v1.
  // ══════════════════════════════════════════════════════════════════════════

  // { id:'lexisnexis-pa',      name:'LexisNexis PatentAdvisor',           ... tier:'H', priority:'HIGH', auth:'api-key-paid' },
  // { id:'derwent-innovation', name:'Thomson Reuters Derwent Innovation', ... tier:'H', priority:'HIGH', auth:'api-key-paid' },
  // { id:'patsnap',            name:'PatSnap API',                        ... tier:'H', priority:'HIGH', auth:'api-key-paid' },
  // { id:'questel-orbit',      name:'Questel Orbit Intelligence',         ... tier:'H', priority:'MEDIUM', auth:'api-key-paid' },
  // { id:'minesoft-patbase',   name:'Minesoft PatBase',                   ... tier:'H', priority:'MEDIUM', auth:'api-key-paid' },
  // { id:'relecura',           name:'Relecura',                           ... tier:'H', priority:'LOW', auth:'api-key-paid' },

];

// ─────────────────────────────────────────────────────────────────────────────
// Source groupings for the ingestion pipeline
// ─────────────────────────────────────────────────────────────────────────────

const BY_PILLAR = {
  novelty:        PATENTABILITY_SOURCES.filter(s => s.pillars?.includes('novelty')),
  non_obvious:    PATENTABILITY_SOURCES.filter(s => s.pillars?.includes('non_obvious')),
  utility:        PATENTABILITY_SOURCES.filter(s => s.pillars?.includes('utility')),
  eligibility:    PATENTABILITY_SOURCES.filter(s => s.pillars?.includes('eligibility')),
  art_unit_routing: PATENTABILITY_SOURCES.filter(s => s.pillars?.includes('art_unit_routing')),
};

const BY_TIER = {
  A: PATENTABILITY_SOURCES.filter(s => s.tier === 'A'),
  B: PATENTABILITY_SOURCES.filter(s => s.tier === 'B'),
  C: PATENTABILITY_SOURCES.filter(s => s.tier === 'C'),
  D: PATENTABILITY_SOURCES.filter(s => s.tier === 'D'),
  E: PATENTABILITY_SOURCES.filter(s => s.tier === 'E'),
  F: PATENTABILITY_SOURCES.filter(s => s.tier === 'F'),
  G: PATENTABILITY_SOURCES.filter(s => s.tier === 'G'),
};

const CRITICAL_SOURCES = PATENTABILITY_SOURCES.filter(s => s.priority === 'CRITICAL');

// ─────────────────────────────────────────────────────────────────────────────
// Public surface: aggregate statistics for messaging (no source names leaked)
// ─────────────────────────────────────────────────────────────────────────────

const PUBLIC_STATS = {
  totalSources:      PATENTABILITY_SOURCES.length,
  coverageScope:     'US, Europe, WIPO, Japan, Korea, China, plus academic and open-source prior art',
  updateCadence:     'daily',
  // Never expose: source names, tier names, priority levels, pillar mappings
};

module.exports = {
  PATENTABILITY_SOURCES,
  BY_PILLAR,
  BY_TIER,
  CRITICAL_SOURCES,
  PUBLIC_STATS,
};
