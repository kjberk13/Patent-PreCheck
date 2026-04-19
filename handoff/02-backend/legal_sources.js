// ─────────────────────────────────────────────────────────────────────────────
// Patent PreCheck — Legal Intelligence Feed Registry v3.0
// Comprehensive RSS + API coverage: courts, USPTO, law firms, news agencies,
// IP organizations, academic journals, international bodies, AI policy orgs
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES = [

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 1 — GOVERNMENT & COURTS (authoritative, free)
  // ══════════════════════════════════════════════════════════════════════════

  // USPTO
  { id:'uspto-news', name:'USPTO Patent News', url:'https://www.uspto.gov/rss/patent/news/patent_news.xml', type:'rss', tier:1, priority:'HIGH', tags:['uspto','patent','guidance'] },
  { id:'uspto-ai-guidance', name:'USPTO — AI Inventorship (Federal Register)', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=patent-and-trademark-office&conditions[term]=artificial+intelligence+inventorship&order=newest&per_page=20', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['uspto','ai','inventorship'] },
  { id:'uspto-fr-notices', name:'USPTO — Federal Register Notices', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=patent-and-trademark-office&conditions[type][]=Notice&order=newest&per_page=25', type:'json', tier:1, priority:'HIGH', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['uspto','notice'] },
  { id:'uspto-fr-rules', name:'USPTO — Federal Register Rules', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=patent-and-trademark-office&conditions[type][]=Rule&order=newest&per_page=15', type:'json', tier:1, priority:'HIGH', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['uspto','rule'] },
  { id:'uspto-fr-proposed', name:'USPTO — Proposed Rules', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=patent-and-trademark-office&conditions[type][]=Proposed+Rule&order=newest&per_page=10', type:'json', tier:1, priority:'HIGH', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['uspto','proposed-rule'] },
  { id:'uspto-tm-news', name:'USPTO Trademark News', url:'https://www.uspto.gov/rss/trademark/news/trademark_news.xml', type:'rss', tier:1, priority:'MEDIUM', tags:['uspto','trademark'] },

  // Copyright Office
  { id:'copyright-news', name:'Copyright Office — News RSS', url:'https://www.copyright.gov/newsnet/rss.xml', type:'rss', tier:1, priority:'HIGH', tags:['copyright','registration','authorship'] },
  { id:'copyright-fr', name:'Copyright Office — Federal Register', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=copyright-office&conditions[type][]=Notice&order=newest&per_page=20', type:'json', tier:1, priority:'HIGH', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['copyright','federal-register'] },

  // Federal Courts via CourtListener
  { id:'cl-cafc-all', name:'CourtListener — Federal Circuit All Opinions', url:'https://www.courtlistener.com/api/rest/v4/opinions/?court=cafc&order_by=-date_created&page_size=25', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'case_name', dateField:'date_created', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['federal-circuit','case-law'] },
  { id:'cl-cafc-patent', name:'CourtListener — Fed Circuit Patent Cases', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=patent&court=cafc&order_by=score+desc&page_size=20', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['federal-circuit','patent'] },
  { id:'cl-ai-patent', name:'CourtListener — AI Patent & Inventorship', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=artificial+intelligence+patent+inventorship+human+conception&order_by=score+desc&page_size=20', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['ai','inventorship','patent'] },
  { id:'cl-section101', name:'CourtListener — Section 101 / Alice-Mayo', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=section+101+abstract+idea+alice+mayo+software+patent&court=cafc+scotus&order_by=score+desc&page_size=15', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['section101','alice','mayo','eligibility'] },
  { id:'cl-scotus', name:'CourtListener — SCOTUS IP', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=patent+intellectual+property&court=scotus&order_by=-date_created&page_size=10', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['scotus','patent','ip'] },
  { id:'cl-columbia-gendigital', name:'CourtListener — Columbia v. Gen Digital (Monitor)', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=Columbia+University+Gen+Digital&order_by=score+desc&page_size=5', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['columbia-gendigital','damages','monitored'] },
  { id:'cl-fortress-iron', name:'CourtListener — Fortress Iron (Monitor)', url:'https://www.courtlistener.com/api/rest/v4/search/?type=o&q=Fortress+Iron+inventorship+transparency&order_by=score+desc&page_size=5', type:'json', tier:1, priority:'CRITICAL', jsonPath:'results', titleField:'caseName', dateField:'dateFiled', urlField:'absolute_url', urlPrefix:'https://www.courtlistener.com', tags:['fortress-iron','inventorship','monitored'] },

  // International Government
  { id:'wipo-news', name:'WIPO — International IP News', url:'https://www.wipo.int/about-wipo/en/wipo_news/rss/', type:'rss', tier:1, priority:'MEDIUM', tags:['wipo','international'] },
  { id:'wipo-patent-news', name:'WIPO — Patent News', url:'https://www.wipo.int/patentscope/en/rss.xml', type:'rss', tier:1, priority:'MEDIUM', tags:['wipo','patent','international'] },
  { id:'epo-news', name:'EPO — European Patent Office News', url:'https://www.epo.org/en/news-events/rss.xml', type:'rss', tier:1, priority:'MEDIUM', tags:['epo','europe','international'] },
  { id:'ukipo-news', name:'UKIPO — UK Intellectual Property Office', url:'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=intellectual-property-office', type:'rss', tier:1, priority:'MEDIUM', tags:['ukipo','uk','international'] },
  { id:'fr-ai-eo', name:'Federal Register — AI Executive Orders', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[term]=artificial+intelligence+patent+invention&conditions[type][]=Executive+Order&order=newest&per_page=10', type:'json', tier:1, priority:'HIGH', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['ai','executive-order','policy'] },
  { id:'fr-nist', name:'Federal Register — NIST AI Standards', url:'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=national-institute-of-standards-and-technology&conditions[term]=artificial+intelligence&order=newest&per_page=10', type:'json', tier:1, priority:'MEDIUM', jsonPath:'results', titleField:'title', dateField:'publication_date', urlField:'html_url', tags:['nist','ai','standards'] },
  { id:'ftc-news', name:'FTC — Technology & IP Policy', url:'https://www.ftc.gov/feeds/press-release.xml', type:'rss', tier:1, priority:'LOW', tags:['ftc','ip-policy','technology'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2A — MAJOR IP LAW BLOGS & TRACKERS (free, interpretive)
  // ══════════════════════════════════════════════════════════════════════════

  // Core Patent Blogs
  { id:'ipwatchdog-main', name:'IPWatchdog — Main (Daily)', url:'https://www.ipwatchdog.com/feed/', type:'rss', tier:2, priority:'HIGH', tags:['patent','news','ipwatchdog'], note:'Key for Director Squires memoranda on AI-assisted inventions' },
  { id:'ipwatchdog-ai', name:'IPWatchdog — AI Category', url:'https://www.ipwatchdog.com/category/artificial-intelligence/feed/', type:'rss', tier:2, priority:'HIGH', tags:['ai','patent','ipwatchdog'] },
  { id:'ipwatchdog-software', name:'IPWatchdog — Software Patents', url:'https://www.ipwatchdog.com/category/software-patents/feed/', type:'rss', tier:2, priority:'HIGH', tags:['software-patent','section101'] },
  { id:'ipwatchdog-alice', name:'IPWatchdog — Alice/101 Category', url:'https://www.ipwatchdog.com/category/alice/feed/', type:'rss', tier:2, priority:'CRITICAL', tags:['alice','section101','eligibility'] },
  { id:'patentlyo', name:'Patently-O — Patent Law Blog', url:'https://patentlyo.com/patent/atom.xml', type:'rss', tier:2, priority:'HIGH', tags:['patent-law','case-law','academic'] },
  { id:'patent-docs', name:'Patent Docs — Biotech & Chemical Blog', url:'https://www.patentdocs.org/atom.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['patent','biotech','chemical','eligibility'] },
  { id:'patent-hacks', name:'Patent Hacks — Developer USPTO Tracker', url:'https://www.patenthacks.com/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['developer','indie','uspto'], note:'USPTO changes affecting indie software developers' },
  { id:'scotusblog-ip', name:'SCOTUS Blog — IP Cases', url:'https://www.scotusblog.com/category/cases/intellectual-property/feed/', type:'rss', tier:2, priority:'CRITICAL', tags:['scotus','ip','supreme-court'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2B — LAW FIRM IP BLOGS (free, practitioner-level analysis)
  // ══════════════════════════════════════════════════════════════════════════

  { id:'squire-patton', name:'Squire Patton Boggs — IP Tech Blog', url:'https://www.squirepattonboggs.com/en/services/practices/intellectual-property/ip-tech-blog/rss', type:'rss', tier:2, priority:'HIGH', tags:['law-firm','software-patent','damages','geographic'], note:'Columbia v. Gen Digital follow-on coverage' },
  { id:'finnegan-ip', name:'Finnegan Henderson — IP Law Blog', url:'https://www.finnegan.com/en/insights/rss.xml', type:'rss', tier:2, priority:'HIGH', tags:['law-firm','patent','finnegan'], note:'Top patent prosecution firm' },
  { id:'fish-ip', name:"Fish & Richardson — IP Blog", url:'https://www.fr.com/fish-ip-law/feed/', type:'rss', tier:2, priority:'HIGH', tags:['law-firm','patent','fish-richardson'] },
  { id:'morrison-ip', name:'Morrison Foerster — IP Blog', url:'https://www.mofo.com/resources/insights/feed/rss.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','ip','tech'] },
  { id:'cooley-ip', name:'Cooley — IP & Tech Insights', url:'https://www.cooley.com/news/publications/rss', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','ip','tech','startup'] },
  { id:'wilson-sonsini', name:'Wilson Sonsini — Tech & IP', url:'https://www.wsgr.com/rss/all-insights.rss', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','ip','tech','startup'] },
  { id:'fenwick-ip', name:'Fenwick & West — IP Insights', url:'https://www.fenwick.com/insights?rss=true', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','ip','tech'] },
  { id:'perkins-coie-ip', name:'Perkins Coie — IP Blog', url:'https://www.perkinscoie.com/en/news-insights/feed/intellectual-property.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','software'] },
  { id:'foley-ip', name:'Foley & Lardner — IP Blog', url:'https://www.foley.com/insights/rss/', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'mwe-ip', name:'McDermott Will & Emery — IP Blog', url:'https://www.mwe.com/insights/rss/?category=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'klgates-ip', name:'K&L Gates — IP Blog', url:'https://www.klgates.com/RSS/Content/Insights/Intellectual-Property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'pillsbury-ip', name:'Pillsbury — IP Blog', url:'https://www.pillsburylaw.com/en/news-and-insights/rss?practice=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'sterne-kessler', name:'Sterne Kessler — Patent Blog', url:'https://www.sternekessler.com/news-insights/news-insights-rss', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','prosecution'] },
  { id:'wilmerhale-ip', name:'WilmerHale — IP Blog', url:'https://www.wilmerhale.com/en/insights/rss?area=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'ropes-gray-ip', name:'Ropes & Gray — IP Insights', url:'https://www.ropesgray.com/en/insights/rss?section=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'dlapiper-ip', name:'DLA Piper — IP Blog', url:'https://www.dlapiper.com/en-us/insights/rss?topic=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','global'] },
  { id:'bakermckenzie-ip', name:'Baker McKenzie — IP Blog', url:'https://insightplus.bakermckenzie.com/bm/intellectual-property_1/feed', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','global'] },
  { id:'orrick-ip', name:'Orrick — Tech & IP Blog', url:'https://www.orrick.com/Insights/RSS?tag=Intellectual-Property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','ip','tech'] },
  { id:'mintz-ip', name:'Mintz — IP Viewpoints', url:'https://www.mintz.com/insights-center/viewpoints/rss?practice=intellectual-property', type:'rss', tier:2, priority:'MEDIUM', tags:['law-firm','patent','ip'] },
  { id:'sheppard-ip', name:"Sheppard Mullin — IP Blog", url:'https://www.sheppardmullin.com/rss?practice=ip-technology', type:'rss', tier:2, priority:'LOW', tags:['law-firm','patent','ip'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2C — LEGAL NEWS AGENCIES (free, reported coverage)
  // ══════════════════════════════════════════════════════════════════════════

  { id:'law360-ip', name:'Law360 — IP', url:'https://www.law360.com/rss/intellectual-property', type:'rss', tier:2, priority:'HIGH', tags:['news','ip','law360'] },
  { id:'jdsupra-ip', name:'JDSupra — IP Law', url:'https://www.jdsupra.com/resources/syndication/docsRSSfeed.aspx?ftype=topic&topic=intellectual+property&batchsize=25', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','legal','analysis'] },
  { id:'abovetlaw-ip', name:'Above the Law — IP', url:'https://abovethelaw.com/category/intellectual-property/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','news'] },
  { id:'ipkat', name:'The IP Kat — International IP', url:'https://ipkitten.blogspot.com/feeds/posts/default', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','international','uk','eu'], note:'UK March 2026 AI copyright report coverage' },
  { id:'managing-ip', name:'Managing Intellectual Property', url:'https://www.managingip.com/rss/all-content', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','news','managing-ip'] },
  { id:'iam-media', name:'IAM Media — IP Strategy', url:'https://www.iam-media.com/rss.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','strategy','licensing'] },
  { id:'ip-watchdog-blog', name:'IP Watchdog Blog', url:'https://ipwatchdog.com/blog/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['ip','blog','opinion'] },
  { id:'clio-ip', name:'Clio — IP Resources', url:'https://www.clio.com/blog/feed/', type:'rss', tier:2, priority:'LOW', tags:['operational','deadlines','procedures'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2D — IP ORGANIZATIONS & BAR ASSOCIATIONS (free)
  // ══════════════════════════════════════════════════════════════════════════

  { id:'aipla', name:'AIPLA — American IP Law Association', url:'https://www.aipla.org/rss.aspx?Type=TodayIP', type:'rss', tier:2, priority:'HIGH', tags:['aipla','patent-bar','policy'] },
  { id:'ipo-org', name:'IPO — Intellectual Property Owners Assn', url:'https://www.ipo.org/rss.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['ipo','patent-owners','policy'] },
  { id:'inta', name:'INTA — International Trademark Assn', url:'https://www.inta.org/rss/', type:'rss', tier:2, priority:'LOW', tags:['inta','trademark','international'] },
  { id:'les-licensing', name:'LES — Licensing Executives Society', url:'https://www.lesi.org/feed', type:'rss', tier:2, priority:'LOW', tags:['licensing','les','ip-strategy'] },
  { id:'acm-digital', name:'ACM — Digital Library News (CS patents)', url:'https://dl.acm.org/rss/rss.xml', type:'rss', tier:2, priority:'LOW', tags:['acm','computer-science','software'] },
  { id:'ieee-spectrum', name:'IEEE Spectrum — Tech & IP', url:'https://spectrum.ieee.org/feeds/feed.rss', type:'rss', tier:2, priority:'LOW', tags:['ieee','tech','software-patents'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2E — ACADEMIC JOURNALS (free/open access)
  // ══════════════════════════════════════════════════════════════════════════

  { id:'ssrn-ip', name:'SSRN — IP & Cyberlaw Papers', url:'https://rss.ssrn.com/abstract_id_rss2.aspx?subjectmatterid=12', type:'rss', tier:2, priority:'MEDIUM', tags:['academic','ssrn','ip-law'] },
  { id:'ssrn-ai-law', name:'SSRN — AI & Law Papers', url:'https://rss.ssrn.com/abstract_id_rss2.aspx?subjectmatterid=21', type:'rss', tier:2, priority:'MEDIUM', tags:['academic','ssrn','ai-law'] },
  { id:'jolt-harvard', name:'Harvard JOLT — Journal of Law & Technology', url:'https://jolt.law.harvard.edu/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['academic','harvard','law-tech'] },
  { id:'stanford-tlr', name:'Stanford Technology Law Review', url:'https://law.stanford.edu/stanford-technology-law-review/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['academic','stanford','tech-law'] },
  { id:'mich-tech-law', name:'Michigan Tech Law Review', url:'https://mttlr.org/feed/', type:'rss', tier:2, priority:'LOW', tags:['academic','michigan','tech-law'] },
  { id:'cardozo-ip', name:'Cardozo Arts & Entertainment Law Journal', url:'https://cardozoaelj.com/feed/', type:'rss', tier:2, priority:'LOW', tags:['academic','cardozo','ip'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2F — AI POLICY & TECHNOLOGY ORGANIZATIONS (free)
  // ══════════════════════════════════════════════════════════════════════════

  { id:'ai-now', name:'AI Now Institute', url:'https://ainowinstitute.org/feed.xml', type:'rss', tier:2, priority:'MEDIUM', tags:['ai-policy','regulation','ai-now'] },
  { id:'partnership-ai', name:'Partnership on AI News', url:'https://partnershiponai.org/feed/', type:'rss', tier:2, priority:'LOW', tags:['ai-policy','partnership'] },
  { id:'ai-index', name:'Stanford AI Index', url:'https://aiindex.stanford.edu/feed/', type:'rss', tier:2, priority:'LOW', tags:['ai','research','stanford'] },
  { id:'brookings-tech', name:'Brookings — Tech & IP Policy', url:'https://www.brookings.edu/topic/technology-innovation/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['policy','tech','brookings'] },
  { id:'mit-tech-review', name:'MIT Technology Review — Legal & Policy', url:'https://www.technologyreview.com/topic/policy/feed/', type:'rss', tier:2, priority:'MEDIUM', tags:['tech-policy','mit','ai'] },
  { id:'cnet-ai-policy', name:'CNET — AI & Legal News', url:'https://www.cnet.com/rss/news/', type:'rss', tier:2, priority:'LOW', tags:['tech-news','ai','policy'] },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 3 — PREMIUM LEGAL DATABASES (API key required)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id:'lexis-ai', name:'Lexis+ AI — Case Law & Protégé', tier:3, premium:true, requiresKey:'LEXIS_API_KEY',
    url:'https://api.lexisnexis.com/v1/research',
    queries:['AI-assisted invention human conception requirement 2025 2026','section 101 abstract idea software patent Federal Circuit 2026','inventorship transparency artificial intelligence USPTO','Fortress Iron inventorship','human-in-the-loop patent requirement','Columbia University Gen Digital damages','Alice Corp weakening Federal Circuit 2026'],
    tags:['lexis','case-law','inventorship','premium'],
    priority:'CRITICAL', note:'Leader for research accuracy. Protégé assistant tracks inventorship trends.',
  },
  {
    id:'westlaw-precision', name:'Westlaw Precision — CoCounsel & KeyCite', tier:3, premium:true, requiresKey:'WESTLAW_API_KEY',
    url:'https://api.thomsonreuters.com/api/westlaw/v1',
    monitors:[
      { case:'Alice Corp. v. CLS Bank', citation:'573 U.S. 208 (2014)' },
      { case:'Mayo Collaborative v. Prometheus', citation:'566 U.S. 66 (2012)' },
      { case:'Bilski v. Kappos', citation:'561 U.S. 593 (2010)' },
      { case:'Enfish LLC v. Microsoft', citation:'822 F.3d 1327 (Fed. Cir. 2016)' },
      { case:'Berkheimer v. HP Inc.', citation:'881 F.3d 1360 (Fed. Cir. 2018)' },
      { case:'Columbia Univ. v. Gen Digital', citation:'March 2026' },
      { case:'Thaler v. Vidal', citation:'43 F.4th 1207 (Fed. Cir. 2022)' },
    ],
    tags:['westlaw','keycite','overruling-risk','premium'],
    priority:'CRITICAL', note:'Best for Overruling Risk on Alice, Mayo, and AI inventorship cases.',
  },
  {
    id:'bloomberg-law', name:'Bloomberg Law — IP Monitor', tier:3, premium:true, requiresKey:'BLOOMBERG_LAW_KEY',
    url:'https://api.bloomberglaw.com/api/v1/news',
    queries:['patent eligibility software 2026','AI inventorship human conception','Federal Circuit patent ruling'],
    tags:['bloomberg','legal-news','premium'],
    priority:'HIGH',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 4 — AI PATENT INTELLIGENCE PLATFORMS (API key required)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id:'patsnap', name:'PatSnap — Innovation Intelligence', tier:4, premium:true, requiresKey:'PATSNAP_API_KEY',
    url:'https://api.patsnap.com/v1',
    capabilities:['Patent landscape mapping for AI code sectors','White space identification where human conception is easiest to prove','Competitive intelligence','Innovation cluster analysis'],
    tags:['patsnap','landscape','whitespace','premium'], priority:'HIGH',
  },
  {
    id:'solve-intelligence', name:'Solve Intelligence — Patent Copilot', tier:4, premium:true, requiresKey:'SOLVE_INTELLIGENCE_KEY',
    url:'https://api.solveintelligence.com/v1',
    capabilities:["Document human inventor's definite and permanent idea",'Protection against inventorship challenges','Structured inventor interview generation','Conception timestamp and evidence documentation'],
    tags:['solve','conception','inventorship','premium'], priority:'HIGH',
  },
  {
    id:'patent-bots', name:'Patent Bots — Art Unit Prediction', tier:4, premium:true, requiresKey:'PATENT_BOTS_KEY',
    url:'https://api.patentbots.com/v1',
    capabilities:['Art Unit Prediction for software and AI-based claims','Examiner allowance rate analysis','Avoidance routing around toughest software patent examiners'],
    tags:['patent-bots','art-unit','examiner','premium'], priority:'MEDIUM',
  },
  {
    id:'clarivate-derwent', name:'Clarivate Derwent — Global Patent Intelligence', tier:4, premium:true, requiresKey:'CLARIVATE_API_KEY',
    url:'https://api.clarivate.com/api/derwent/v1',
    capabilities:['Global patent landscape monitoring','UK March 2026 AI copyright report tracking','EPO AI inventorship updates','International prior art search'],
    tags:['clarivate','derwent','international','uk','epo','premium'], priority:'HIGH',
  },
  {
    id:'docket-alarm', name:'Docket Alarm — PTAB & Court Monitoring', tier:4, premium:true, requiresKey:'DOCKET_ALARM_KEY',
    url:'https://www.docketalarm.com/api/v1',
    capabilities:['PTAB IPR and PGR proceedings monitoring','Real-time court docket alerts for patent cases','Alice/101 rejection tracking at PTAB'],
    tags:['docket-alarm','ptab','ipr','pgr','premium'], priority:'HIGH',
  },
];

// ── Source counts by tier ───────────────────────────────────────────────────
const TIER_SUMMARY = {
  1: { label:'Government & Courts', count: SOURCES.filter(s=>s.tier===1).length },
  2: { label:'Law Blogs, Firms & Organizations', count: SOURCES.filter(s=>s.tier===2).length },
  3: { label:'Premium Legal Databases', count: SOURCES.filter(s=>s.tier===3).length },
  4: { label:'AI Patent Intelligence Platforms', count: SOURCES.filter(s=>s.tier===4).length },
};

console.log('Patent PreCheck Legal Source Registry v3.0');
console.log(`Total sources: ${SOURCES.length}`);
Object.entries(TIER_SUMMARY).forEach(([t,v]) => console.log(`  Tier ${t} — ${v.label}: ${v.count}`));

module.exports = { SOURCES, TIER_SUMMARY };

// ─────────────────────────────────────────────────────────────────────────────
// EXPANDED SOURCE REGISTRY — Appended April 2026
// Major law firm blogs, news agencies, institutions, and international sources
// ─────────────────────────────────────────────────────────────────────────────

const EXPANDED_SOURCES = [

  // ══ MAJOR LAW FIRM IP BLOGS ══════════════════════════════════════════════

  {
    id: 'finnegan-federal-circuit',
    name: 'Finnegan — Federal Circuit Blog',
    url: 'https://www.finnegan.com/en/insights/blogs/federal-circuit-ip/rss.xml',
    type: 'rss', tier: 2,
    tags: ['federal-circuit','section101','ai-patent','finnegan'],
    priority: 'HIGH',
    note: 'Leading IP firm. Covered Recentive Analytics v. Fox Corp (ML patent § 101) and USPTO AI search pilot.',
  },
  {
    id: 'finnegan-prosecution-first',
    name: 'Finnegan — Prosecution First Blog',
    url: 'https://www.finnegan.com/en/insights/blogs/prosecution-first/rss.xml',
    type: 'rss', tier: 2,
    tags: ['prosecution','uspto','examination','finnegan'],
    priority: 'HIGH',
  },
  {
    id: 'finnegan-ptab',
    name: 'Finnegan — At the PTAB Blog',
    url: 'https://www.finnegan.com/en/insights/blogs/at-the-ptab-blog/rss.xml',
    type: 'rss', tier: 2,
    tags: ['ptab','ipr','pgr','inter-partes','finnegan'],
    priority: 'HIGH',
    note: 'Covered Director Squires March 2026 memo on IPR/PGR manufacturing factors.',
  },
  {
    id: 'fish-richardson',
    name: 'Fish & Richardson — IP Blog',
    url: 'https://www.fr.com/insights/rss/',
    type: 'rss', tier: 2,
    tags: ['patent','ip','federal-circuit','fish-richardson'],
    priority: 'HIGH',
  },
  {
    id: 'morrison-foerster-ip',
    name: 'Morrison Foerster — IP & Technology',
    url: 'https://www.mofo.com/resources/insights/rss.xml',
    type: 'rss', tier: 2,
    tags: ['ip','technology','ai','privacy','mofo'],
    priority: 'MEDIUM',
  },
  {
    id: 'venable-ip',
    name: 'Venable LLP — IP Insights',
    url: 'https://www.venable.com/insights/rss/',
    type: 'rss', tier: 2,
    tags: ['patent','section101','ai-inventorship','venable'],
    priority: 'HIGH',
    note: 'Published § 101 Reset for 2026: New USPTO Guidance on AI Eligibility — key source.',
  },
  {
    id: 'wilson-sonsini-ip',
    name: 'Wilson Sonsini — IP Blog',
    url: 'https://www.wsgr.com/en/insights/rss.xml',
    type: 'rss', tier: 2,
    tags: ['patent','startup','ip','technology'],
    priority: 'MEDIUM',
  },
  {
    id: 'jones-day-ip',
    name: 'Jones Day — IP Commentary',
    url: 'https://www.jonesday.com/en/insights/rss',
    type: 'rss', tier: 2,
    tags: ['patent','ip','litigation','jones-day'],
    priority: 'MEDIUM',
  },
  {
    id: 'perkins-coie-ip',
    name: 'Perkins Coie — Patent Law',
    url: 'https://www.perkinscoie.com/insights/rss.xml',
    type: 'rss', tier: 2,
    tags: ['patent','technology','ai','software'],
    priority: 'MEDIUM',
  },
  {
    id: 'banner-witcoff',
    name: 'Banner Witcoff — Patent Insights',
    url: 'https://www.bannerwitcoff.com/news/rss/',
    type: 'rss', tier: 2,
    tags: ['patent','prosecution','software','ai'],
    priority: 'MEDIUM',
  },
  {
    id: 'fenwick-west-ip',
    name: 'Fenwick & West — IP & Technology',
    url: 'https://www.fenwick.com/insights/rss',
    type: 'rss', tier: 2,
    tags: ['patent','technology','ai','software','startup'],
    priority: 'MEDIUM',
  },
  {
    id: 'cooley-ip',
    name: 'Cooley LLP — IP & Tech',
    url: 'https://www.cooley.com/insights/rss',
    type: 'rss', tier: 2,
    tags: ['patent','startup','ai','software'],
    priority: 'MEDIUM',
  },
  {
    id: 'orrick-ip',
    name: 'Orrick — IP & Technology',
    url: 'https://www.orrick.com/insights/rss',
    type: 'rss', tier: 2,
    tags: ['patent','ai','technology','software'],
    priority: 'MEDIUM',
  },
  {
    id: 'knobbe-martens',
    name: 'Knobbe Martens — IP Blog',
    url: 'https://www.knobbe.com/news/rss',
    type: 'rss', tier: 2,
    tags: ['patent','ip','prosecution','federal-circuit'],
    priority: 'HIGH',
    note: 'Specialist IP firm — strong coverage of Federal Circuit and USPTO practice.',
  },
  {
    id: 'sughrue-mion',
    name: 'Sughrue Mion — IP Insights',
    url: 'https://www.sughrue.com/rss.xml',
    type: 'rss', tier: 2,
    tags: ['patent','prosecution','software','ai'],
    priority: 'MEDIUM',
  },
  {
    id: 'leason-ellis',
    name: 'Leason Ellis — IP Blog',
    url: 'https://www.leasonellis.com/feed/',
    type: 'rss', tier: 2,
    tags: ['patent','trademark','copyright','ip'],
    priority: 'LOW',
  },
  {
    id: 'eric-goldman-blog',
    name: 'Eric Goldman — Technology & Marketing Law Blog',
    url: 'https://blog.ericgoldman.org/feed',
    type: 'rss', tier: 2,
    tags: ['internet-law','ip','ai','technology'],
    priority: 'MEDIUM',
    note: 'ABA Blawg Hall of Fame. Covers AI, internet law, and IP policy.',
  },

  // ══ IP PUBLICATIONS & NEWS OUTLETS ══════════════════════════════════════

  {
    id: 'managing-ip-patents',
    name: 'Managing IP — Patents RSS',
    url: 'https://www.managingip.com/section/patents/rss',
    type: 'rss', tier: 2,
    tags: ['patent','ip','international','managing-ip'],
    priority: 'HIGH',
  },
  {
    id: 'managing-ip-strategy',
    name: 'Managing IP — IP Strategy RSS',
    url: 'https://www.managingip.com/section/ip-strategy/rss',
    type: 'rss', tier: 2,
    tags: ['ip-strategy','patent','licensing'],
    priority: 'MEDIUM',
  },
  {
    id: 'iam-media',
    name: 'IAM — Intellectual Asset Management',
    url: 'https://www.iam-media.com/rss',
    type: 'rss', tier: 2,
    tags: ['patent','ip','licensing','policy','iam'],
    priority: 'HIGH',
    note: 'IAM Patent 1000 publisher. Premium IP strategy coverage.',
  },
  {
    id: 'world-ip-review',
    name: 'World IP Review',
    url: 'https://www.worldipreview.com/rss',
    type: 'rss', tier: 2,
    tags: ['ip','patent','international','policy'],
    priority: 'MEDIUM',
  },
  {
    id: 'world-trademark-review',
    name: 'World Trademark Review',
    url: 'https://www.worldtrademarkreview.com/rss',
    type: 'rss', tier: 2,
    tags: ['trademark','brand','ip'],
    priority: 'LOW',
  },
  {
    id: 'kluwer-patent-blog',
    name: 'Kluwer Patent Blog',
    url: 'https://patentblog.kluweriplaw.com/feed/',
    type: 'rss', tier: 2,
    tags: ['patent','epo','international','kluwer'],
    priority: 'HIGH',
    note: 'Premier international patent law blog. Strong EPO and UK coverage.',
  },
  {
    id: 'ipkat-full',
    name: 'The IP Kat — Full Feed',
    url: 'https://ipkitten.blogspot.com/feeds/posts/default',
    type: 'rss', tier: 2,
    tags: ['ip','international','eu','uk','europe'],
    priority: 'MEDIUM',
  },
  {
    id: 'china-ipr',
    name: 'China IPR Blog',
    url: 'https://chinaipr.com/feed/',
    type: 'rss', tier: 2,
    tags: ['china','ip','patent','international'],
    priority: 'MEDIUM',
    note: 'Chinese IP law — relevant for global distribution and prior art.',
  },
  {
    id: 'law360-patents',
    name: 'Law360 — Patents',
    url: 'https://www.law360.com/ip/rss',
    type: 'rss', tier: 2,
    tags: ['patent','litigation','news'],
    priority: 'HIGH',
  },
  {
    id: 'jdsupra-ip',
    name: 'JDSupra — IP Law',
    url: 'https://www.jdsupra.com/resources/syndication/docsRSSfeed.aspx?ftype=topic&topic=intellectual+property&batchsize=20',
    type: 'rss', tier: 2,
    tags: ['ip','patent','legal-analysis'],
    priority: 'MEDIUM',
  },
  {
    id: 'jdsupra-ai',
    name: 'JDSupra — Artificial Intelligence',
    url: 'https://www.jdsupra.com/resources/syndication/docsRSSfeed.aspx?ftype=topic&topic=artificial+intelligence&batchsize=20',
    type: 'rss', tier: 2,
    tags: ['ai','law','policy','patent'],
    priority: 'HIGH',
  },
  {
    id: 'technollama',
    name: 'TechnoLlama — Open Licensing & Digital Rights',
    url: 'https://www.technollama.co.uk/feed',
    type: 'rss', tier: 2,
    tags: ['copyright','open-source','software','digital-rights'],
    priority: 'LOW',
  },

  // ══ GOVERNMENT & REGULATORY ══════════════════════════════════════════════

  {
    id: 'federal-register-ptab',
    name: 'Federal Register — PTAB Rules',
    url: 'https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=patent-and-trademark-office&conditions[term]=Patent+Trial+and+Appeal+Board&order=newest&per_page=10',
    type: 'json', tier: 1,
    tags: ['ptab','ipr','pgr','rules','federal-register'],
    priority: 'CRITICAL',
    jsonPath: 'results', titleField: 'title', dateField: 'publication_date', urlField: 'html_url',
  },
  {
    id: 'federal-register-copyright-ai',
    name: 'Federal Register — Copyright + AI',
    url: 'https://www.federalregister.gov/api/v1/documents.json?conditions[term]=artificial+intelligence+copyright&conditions[agencies][]=copyright-office&order=newest&per_page=10',
    type: 'json', tier: 1,
    tags: ['copyright','ai','authorship'],
    priority: 'HIGH',
    jsonPath: 'results', titleField: 'title', dateField: 'publication_date', urlField: 'html_url',
  },
  {
    id: 'nih-tech-transfer',
    name: 'NIH — Technology Transfer (inventorship standards)',
    url: 'https://www.ott.nih.gov/rss-feeds',
    type: 'rss', tier: 1,
    tags: ['inventorship','tech-transfer','government'],
    priority: 'LOW',
  },
  {
    id: 'nist-ai',
    name: 'NIST — AI Policy & Standards',
    url: 'https://www.nist.gov/news-events/news/rss.xml',
    type: 'rss', tier: 1,
    tags: ['ai','policy','standards','nist'],
    priority: 'MEDIUM',
    note: 'NIST AI Risk Management Framework updates affect AI inventorship standards.',
  },
  {
    id: 'whitehouse-ostp',
    name: 'White House OSTP — Science & Technology Policy',
    url: 'https://www.whitehouse.gov/ostp/feed/',
    type: 'rss', tier: 1,
    tags: ['ai-policy','executive','ostp','technology'],
    priority: 'MEDIUM',
  },
  {
    id: 'epo-news',
    name: 'EPO — News & Press',
    url: 'https://www.epo.org/rss/news.xml',
    type: 'rss', tier: 1,
    tags: ['epo','europe','patent','international'],
    priority: 'HIGH',
    note: 'European Patent Office — AI inventorship and software patent eligibility updates.',
  },
  {
    id: 'ukipo-news',
    name: 'UK IPO — News',
    url: 'https://www.gov.uk/government/organisations/intellectual-property-office.atom',
    type: 'rss', tier: 1,
    tags: ['uk','ipo','patent','copyright','ai'],
    priority: 'HIGH',
    note: 'UK March 2026 AI copyright and patent report — monitored here.',
  },

  // ══ ACADEMIC & POLICY ════════════════════════════════════════════════════

  {
    id: 'stanford-codex',
    name: 'Stanford CodeX — Law + Technology',
    url: 'https://law.stanford.edu/codex-the-stanford-center-for-legal-informatics/feed/',
    type: 'rss', tier: 2,
    tags: ['legal-tech','ai','policy','academic'],
    priority: 'MEDIUM',
  },
  {
    id: 'harvard-law-review-ip',
    name: 'Harvard Law Review — IP / Technology',
    url: 'https://harvardlawreview.org/category/patent/feed/',
    type: 'rss', tier: 2,
    tags: ['academic','patent','ip','harvard'],
    priority: 'MEDIUM',
  },
  {
    id: 'yale-law-journal-ip',
    name: 'Yale Law Journal — IP',
    url: 'https://www.yalelawjournal.org/feed',
    type: 'rss', tier: 2,
    tags: ['academic','patent','ip','yale'],
    priority: 'LOW',
  },
  {
    id: 'ssrn-patent',
    name: 'SSRN — Patent Law Preprints',
    url: 'https://papers.ssrn.com/sol3/Jeljour_results.cfm?form_name=journalBrowse&journal_id=988&Network=no&SortOrder=ab_approval_date&limit=10&rss=1',
    type: 'rss', tier: 2,
    tags: ['academic','research','patent','preprint'],
    priority: 'LOW',
  },
  {
    id: 'berkman-klein-ai',
    name: 'Berkman Klein Center — AI & Law',
    url: 'https://cyber.harvard.edu/feeds/all',
    type: 'rss', tier: 2,
    tags: ['ai','law','policy','academic'],
    priority: 'LOW',
  },

  // ══ TECH & AI NEWS (patent relevance) ═══════════════════════════════════

  {
    id: 'techcrunch-ai',
    name: 'TechCrunch — AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    type: 'rss', tier: 2,
    tags: ['ai','startup','technology','funding'],
    priority: 'LOW',
    note: 'Monitors AI patent-adjacent news — new AI tools, inventorship disputes, VC-backed patent activity.',
  },
  {
    id: 'the-register-patents',
    name: 'The Register — Law & Patents',
    url: 'https://www.theregister.com/legal/patents/headlines.atom',
    type: 'rss', tier: 2,
    tags: ['patent','software','technology','uk'],
    priority: 'MEDIUM',
  },
  {
    id: 'arstechnica-law',
    name: 'Ars Technica — Law & Disorder',
    url: 'https://feeds.arstechnica.com/arstechnica/tech-policy',
    type: 'rss', tier: 2,
    tags: ['patent','copyright','tech-policy','software'],
    priority: 'MEDIUM',
    note: 'Strong coverage of software patent and copyright cases, accessible analysis.',
  },

  // ══════════════════════════════════════════════════════════════════
  // EXPANDED TIER 2 — LAW FIRM BLOGS & SPECIALIZED IP FEEDS
  // Full RSS coverage of all major IP law firms and institutions
  // ══════════════════════════════════════════════════════════════════

  // Federal Circuit Official Opinions
  {id:'cafc-official',name:'Federal Circuit — Official Opinions RSS',
   url:'https://cafc.uscourts.gov/rss.xml',type:'rss',tier:1,
   tags:['federal-circuit','cafc','opinions','authoritative'],priority:'CRITICAL'},

  // Patent Docs — Biotech/pharma/software patent law blog by practitioners
  {id:'patent-docs',name:'Patent Docs — Patent Law Blog',
   url:'https://www.patentdocs.org/atom.xml',type:'rss',tier:2,
   tags:['patent','biotech','software','case-law','practitioners'],priority:'HIGH'},

  // National Law Review — IP section
  {id:'national-law-review-ip',name:'National Law Review — IP',
   url:'https://www.natlawreview.com/recent-content/rss.xml',type:'rss',tier:2,
   tags:['ip','law','news','analysis'],priority:'MEDIUM'},

  // Written Description — Federal Circuit analysis blog
  {id:'written-description',name:'Written Description — Federal Circuit Analysis',
   url:'https://writtendescription.blogspot.com/feeds/posts/default',type:'rss',tier:2,
   tags:['federal-circuit','section101','patent-eligibility'],priority:'HIGH'},

  // Finnegan — AtThePTABBlog (largest IP firm's PTAB tracker)
  {id:'finnegan-ptab',name:'Finnegan — At The PTAB Blog',
   url:'https://www.attheptabblog.com/feed/',type:'rss',tier:2,
   tags:['ptab','ipr','pgr','inter-partes','patent-trial'],priority:'HIGH',
   note:'Finnegan Henderson - world largest IP firm. Tracks all PTAB proceedings.'},

  // Finnegan — Main firm news
  {id:'finnegan-news',name:'Finnegan — IP Firm News & Alerts',
   url:'https://www.finnegan.com/en/insights/rss.xml',type:'rss',tier:2,
   tags:['patent','ip','firm-analysis','alerts'],priority:'MEDIUM'},

  // Knobbe Martens — Federal Circuit coverage
  {id:'knobbe-fed-circuit',name:'Knobbe Martens — Federal Circuit Blog',
   url:'https://knobbe.com/services/litigation-and-federal-circuit/feed/',type:'rss',tier:2,
   tags:['federal-circuit','patent','litigation','knobbe'],priority:'HIGH'},

  // Knobbe Martens — PTAB / IPR coverage
  {id:'knobbe-ptab',name:'Knobbe Martens — PTAB / IPR',
   url:'https://knobbe.com/services/post-grant-proceedings/feed/',type:'rss',tier:2,
   tags:['ptab','ipr','patent-trial','post-grant'],priority:'HIGH'},

  // Knobbe Martens — Software & Electronics
  {id:'knobbe-software',name:'Knobbe Martens — Software & Electronics Patent',
   url:'https://knobbe.com/services/electronics-semiconductors/feed/',type:'rss',tier:2,
   tags:['software-patent','electronics','section101'],priority:'HIGH'},

  // McDermott Will & Emery — IP
  {id:'mcdermott-ip',name:'McDermott Will & Emery — IP Blog',
   url:'https://www.mwe.com/rss/insights/',type:'rss',tier:2,
   tags:['ip','patent','litigation','mcdermott'],priority:'MEDIUM'},

  // Foley & Lardner — IP
  {id:'foley-ip',name:'Foley & Lardner — IP Insights',
   url:'https://www.foley.com/insights/category/intellectual-property/feed/',type:'rss',tier:2,
   tags:['ip','patent','trademark','foley'],priority:'MEDIUM'},

  // Fox Rothschild — IP
  {id:'fox-rothschild-ip',name:'Fox Rothschild — IP Blog',
   url:'https://www.foxrothschild.com/rss/insights/',type:'rss',tier:2,
   tags:['ip','patent','trademark'],priority:'LOW'},

  // Jones Day — PTAB Litigation
  {id:'jones-day-ptab',name:'Jones Day — PTAB Litigation Blog',
   url:'https://www.jonesday.com/en/insights/rss',type:'rss',tier:2,
   tags:['ptab','ipr','patent-trial','jones-day'],priority:'MEDIUM'},

  // BakerHostetler — IP Intelligence
  {id:'baker-hostetler-ip',name:'BakerHostetler — IP Intelligence',
   url:'https://www.bakerlaw.com/rss/',type:'rss',tier:2,
   tags:['ip','patent','copyright','baker'],priority:'MEDIUM'},

  // Foley Hoag — IP & Technology
  {id:'foley-hoag-ip',name:'Foley Hoag — IP & Technology Blog',
   url:'https://foleyhoag.com/news-and-insights/blogs/ip-and-technology/feed/',type:'rss',tier:2,
   tags:['ip','technology','patent','copyright'],priority:'MEDIUM'},

  // Proskauer — New England IP
  {id:'proskauer-ip',name:'Proskauer — New England IP Blog',
   url:'https://www.proskauer.com/rss',type:'rss',tier:2,
   tags:['ip','patent','trademark','new-england'],priority:'LOW'},

  // FOSS Patents — Standards & mobile patent tracking
  {id:'foss-patents',name:'FOSS Patents — Standards & Mobile Patent Tracking',
   url:'https://feeds.feedburner.com/fosspatents',type:'rss',tier:2,
   tags:['foss','standards','seps','mobile','software-patent'],priority:'MEDIUM',
   note:'Florian Mueller blog — tracks software patent cases, FRAND/SEP issues globally.'},

  // Managing IP — Global IP intelligence
  {id:'managing-ip',name:'Managing IP — Global IP Intelligence',
   url:'https://www.managingip.com/rss/home',type:'rss',tier:2,
   tags:['ip','global','patent','trademark','managing-ip'],priority:'HIGH'},

  // IP Kat — European & international IP (already in system, upgrade tier)
  // (already listed above as ipkat)

  // Unified Patents — Patent validity & trolls
  {id:'unified-patents',name:'Unified Patents — Patent Validity & Challenges',
   url:'https://www.unifiedpatents.com/insights/feed/',type:'rss',tier:2,
   tags:['patent-validity','ptab','unified-patents','troll'],priority:'MEDIUM'},

  // GreyB — Patent strategy & prior art
  {id:'greyb',name:'GreyB — Patent Strategy & Prior Art Research',
   url:'https://www.greyb.com/feed/',type:'rss',tier:2,
   tags:['patent-strategy','prior-art','landscape','analytics'],priority:'MEDIUM'},

  // IP CloseUp — Business of IP
  {id:'ip-closeup',name:'IP CloseUp — Business of IP',
   url:'https://ipcloseup.com/feed/',type:'rss',tier:2,
   tags:['ip','business','licensing','valuation'],priority:'LOW'},

  // WIPO Magazine
  {id:'wipo-magazine',name:'WIPO Magazine — International IP',
   url:'https://www.wipo.int/wipo_magazine/en/rss/',type:'rss',tier:1,
   tags:['wipo','international','magazine','ip-policy'],priority:'MEDIUM'},

  // Clarivate Blog — Derwent / IP analytics
  {id:'clarivate-blog',name:'Clarivate — IP Analytics Blog',
   url:'https://clarivate.com/feed/',type:'rss',tier:2,
   tags:['clarivate','derwent','analytics','patent-data'],priority:'MEDIUM'},

  // LexisNexis IP Solutions Blog
  {id:'lexisnexis-ip-blog',name:'LexisNexis — IP Solutions Blog',
   url:'https://www.lexisnexis.com/ip-solutions/feed/',type:'rss',tier:2,
   tags:['lexisnexis','ip','research','legal-intelligence'],priority:'MEDIUM'},

  // Global IP & Technology Law Blog (multi-firm)
  {id:'global-ip-tech',name:'Global IP & Technology Law Blog',
   url:'https://www.globaliptechlaw.com/feed/',type:'rss',tier:2,
   tags:['global','ip','technology','cross-border'],priority:'MEDIUM'},

  // PatentVest — IP Legal Insights
  {id:'patentvest',name:'PatentVest — IP Legal Insights',
   url:'https://patentvest.com/ip-legal-insights/feed/',type:'rss',tier:2,
   tags:['patent','ai-invention','section101','patentvest'],priority:'MEDIUM',
   note:'March 2026: Active coverage of AI-assisted invention patentability under Section 101.'},

  // Financial Times — Intellectual Property section
  {id:'ft-ip',name:'Financial Times — Intellectual Property',
   url:'https://www.ft.com/intellectual-property?format=rss',type:'rss',tier:2,
   tags:['financial-times','ip','business','global'],priority:'LOW'},

  // The Guardian — IP coverage
  {id:'guardian-ip',name:'The Guardian — Intellectual Property',
   url:'https://www.theguardian.com/law/intellectual-property/rss',type:'rss',tier:2,
   tags:['guardian','ip','uk','international'],priority:'LOW'},

  // Congress.gov — IP related bills & CRS reports
  {id:'congress-ip',name:'Congress.gov — IP Legislation & CRS Reports',
   url:'https://www.congress.gov/rss/most-viewed-bills.xml',type:'rss',tier:1,
   tags:['congress','legislation','patent-reform','ip-policy'],priority:'HIGH'},

  // EPO — European Patent Office news
  {id:'epo-news',name:'EPO — European Patent Office News',
   url:'https://www.epo.org/rss/news.xml',type:'rss',tier:1,
   tags:['epo','european','patent','international'],priority:'MEDIUM'},

  // UK Intellectual Property Office
  {id:'ukipo',name:'UK IPO — Intellectual Property Office Updates',
   url:'https://www.gov.uk/government/organisations/intellectual-property-office.atom',type:'rss',tier:1,
   tags:['ukipo','uk','patent','copyright','ai-copyright'],priority:'HIGH',
   note:'Essential for tracking UK AI copyright and patent developments post-March 2026.'},

  // IP Watchdog — AI specific
  {id:'ipwatchdog-ai-policy',name:'IPWatchdog — AI & Innovation Policy',
   url:'https://ipwatchdog.com/category/ai-innovation-policy/feed/',type:'rss',tier:2,
   tags:['ai','innovation','policy','uspto-director'],priority:'CRITICAL'},

  // PatentlyO — Federal Circuit decisions tracker
  {id:'patentlyo-fed-circuit',name:'Patently-O — Federal Circuit Decisions',
   url:'https://patentlyo.com/patent/federal-circuit/atom.xml',type:'rss',tier:2,
   tags:['federal-circuit','patent','decisions'],priority:'CRITICAL'},

  // PatentlyO — Section 101 tracker
  {id:'patentlyo-101',name:'Patently-O — Section 101 Coverage',
   url:'https://patentlyo.com/patent/section-101/atom.xml',type:'rss',tier:2,
   tags:['section101','eligibility','alice','software'],priority:'CRITICAL'},

  // Thompson Patent Law — AI Patents 2026
  {id:'thompson-patent-law',name:'Thompson Patent Law — AI Patents',
   url:'https://thompsonpatentlaw.com/feed/',type:'rss',tier:2,
   tags:['ai-patents','section101','inventorship','2026'],priority:'HIGH'},

  // IP Watchdog — USPTO Changes
  {id:'ipwatchdog-uspto',name:'IPWatchdog — USPTO Policy & Guidance',
   url:'https://ipwatchdog.com/category/uspto/feed/',type:'rss',tier:2,
   tags:['uspto','policy','guidance','examiner','director'],priority:'HIGH'},

  // Docket Alarm / PTAB analytics (public feed)
  {id:'ptab-decisions',name:'USPTO PTAB — Trial Statistics & Decisions',
   url:'https://ptab.uspto.gov/api/rss',type:'rss',tier:1,
   tags:['ptab','decisions','ipr','pgr','trial-statistics'],priority:'HIGH'},

  // Asia IP — AI & IP trends
  {id:'asia-ip',name:'Asia IP — Evolving IP Trends',
   url:'https://asiaiplaw.com/rss',type:'rss',tier:2,
   tags:['asia','ip','ai-trends','international'],priority:'LOW'},
];

// ── Merge expanded sources ────────────────────────────────────────────────────
// Add all expanded sources to the main SOURCES array
// (Call this at module init — harmless no-op if SOURCES already contains them)
if (typeof SOURCES !== 'undefined') {
  const existingIds = new Set(SOURCES.map(s => s.id));
  EXPANDED_SOURCES.forEach(s => {
    if (!existingIds.has(s.id)) {
      SOURCES.push(s);
    }
  });
}

module.exports.EXPANDED_SOURCES = EXPANDED_SOURCES;
