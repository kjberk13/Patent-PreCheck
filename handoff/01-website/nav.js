// ── Patent PreCheck — Shared Nav & Footer ──
// Injects the universal nav and footer into every page.
// Just include <script src="nav.js" defer></script> and add
// <div id="ppc-nav"></div> and <div id="ppc-footer"></div> to the page.

(function() {
  // Detect current page to set active link
  const path = window.location.pathname.split('/').pop() || 'index.html';

  const navLinks = [
    { href: 'platform.html', label: 'The Platform', match: 'platform' },
    { href: 'index.html#pricing', label: 'Pricing', match: '#pricing' },
    { href: 'legal-intelligence.html', label: 'Legal Intelligence', match: 'legal-intelligence' },
    { href: 'attorneys.html', label: 'Find an Attorney', match: 'attorneys' },
  ];

  const linksHtml = navLinks.map(l => {
    const active = path.includes(l.match) ? ' style="color:#1D9E75"' : '';
    return `<a href="${l.href}" class="ppc-nav-link"${active}>${l.label}</a>`;
  }).join('');

  const mobileLinksHtml = navLinks.map(l => {
    const active = path.includes(l.match) ? ' style="color:#1D9E75"' : '';
    return `<a href="${l.href}" class="ppc-mobile-link"${active}>${l.label}</a>`;
  }).join('');

  const navHtml = `
<style>
  body.ppc-has-nav { padding-top: 68px; margin: 0; }
  .ppc-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
    display: flex; align-items: center; height: 68px; padding: 0 36px;
    background: rgba(248,250,255,0.97);
    -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
    border-bottom: 1px solid #E2E8F4;
    font-family: 'DM Sans', -apple-system, sans-serif; }
  .ppc-nav-logo { display: flex; align-items: center; text-decoration: none; flex-shrink: 0; }
  .ppc-nav-links { display: flex; align-items: center; gap: 28px; margin-left: 32px; flex: 1; }
  .ppc-nav-link { font-size: 14px; font-weight: 500; color: #2D3748;
    text-decoration: none; transition: color .15s; white-space: nowrap; }
  .ppc-nav-link:hover { color: #1D9E75; }
  .ppc-nav-cta { flex-shrink: 0; background: #0C2340; color: #fff;
    padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600;
    text-decoration: none; white-space: nowrap; transition: background .15s;
    margin-left: 40px; line-height: 1.4; }
  .ppc-nav-cta:hover { background: #1D9E75; }

  /* Hamburger button */
  .ppc-hamburger { display: none; background: none; border: 0; cursor: pointer;
    padding: 10px; margin-left: auto; width: 44px; height: 44px;
    align-items: center; justify-content: center; }
  .ppc-hamburger span { display: block; width: 22px; height: 2px; background: #0C2340;
    position: relative; transition: all .25s ease; border-radius: 2px; }
  .ppc-hamburger span::before, .ppc-hamburger span::after { content: ''; position: absolute;
    left: 0; width: 22px; height: 2px; background: #0C2340; transition: all .25s ease;
    border-radius: 2px; }
  .ppc-hamburger span::before { top: -7px; }
  .ppc-hamburger span::after { top: 7px; }
  .ppc-hamburger[aria-expanded="true"] span { background: transparent; }
  .ppc-hamburger[aria-expanded="true"] span::before { top: 0; transform: rotate(45deg); }
  .ppc-hamburger[aria-expanded="true"] span::after { top: 0; transform: rotate(-45deg); }

  /* Mobile slide-down panel */
  .ppc-mobile-panel { display: none; position: fixed; top: 68px; left: 0; right: 0;
    background: rgba(248,250,255,0.98); -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px); border-bottom: 1px solid #E2E8F4;
    z-index: 999; padding: 12px 20px 20px;
    flex-direction: column; gap: 2px;
    max-height: calc(100vh - 68px); overflow-y: auto;
    box-shadow: 0 8px 24px rgba(12,35,64,0.08);
    animation: ppc-slide-down .2s ease-out; }
  .ppc-mobile-panel.open { display: flex; }
  @keyframes ppc-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
  .ppc-mobile-link { display: block; padding: 14px 12px; font-size: 16px; font-weight: 500;
    color: #0C2340; text-decoration: none; border-bottom: 1px solid #EDF1F9; }
  .ppc-mobile-link:last-of-type { border-bottom: 0; }
  .ppc-mobile-cta { display: block; background: #1D9E75; color: #fff; padding: 14px;
    border-radius: 10px; font-weight: 600; font-size: 15px; text-decoration: none;
    text-align: center; margin-top: 12px; }

  @media (max-width: 760px) {
    .ppc-nav { padding: 0 16px; }
    .ppc-nav-links, .ppc-nav-cta { display: none; }
    .ppc-hamburger { display: flex; }
  }

  /* Logo draw-on animation */
  .ppc-logo-node { opacity: 0; animation: ppc-node-in .35s ease-out forwards;
    transform-box: fill-box; transform-origin: center; }
  .ppc-logo-node-1 { animation-delay: .15s; }
  .ppc-logo-node-2 { animation-delay: .30s; }
  .ppc-logo-node-3 { animation-delay: .45s; }
  .ppc-logo-check { stroke-dasharray: 30; stroke-dashoffset: 30;
    animation: ppc-draw-check .45s cubic-bezier(.55,.15,.45,1) forwards; }
  .ppc-logo-check-1 { animation-delay: .65s; }
  .ppc-logo-check-2 { animation-delay: 1.05s; }
  @keyframes ppc-node-in { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
  @keyframes ppc-draw-check { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .ppc-logo-node { opacity: 1; animation: none; }
    .ppc-logo-check { stroke-dashoffset: 0; animation: none; }
  }

  .ppc-footer { background: #0C2340; padding: 48px 40px 32px; text-align: center;
    font-family: 'DM Sans', -apple-system, sans-serif; }
  .ppc-footer-links { font-size: 13px; color: rgba(255,255,255,.4); margin-bottom: 12px;
    line-height: 2; }
  .ppc-footer-links a { color: rgba(255,255,255,.55); text-decoration: none; margin: 0 10px;
    display: inline-block; padding: 4px 0; }
  .ppc-footer-links a:hover { color: #1D9E75; }
  .ppc-footer-copy { font-size: 13px; color: rgba(255,255,255,.4); }
  @media (max-width: 600px) {
    .ppc-footer { padding: 36px 20px 24px; }
    .ppc-footer-links a { margin: 0 6px; font-size: 12px; }
  }
</style>

<nav class="ppc-nav">
  <a href="index.html" class="ppc-nav-logo" aria-label="Patent PreCheck home">
    <svg height="44" viewBox="0 0 214 44" xmlns="http://www.w3.org/2000/svg">
      <rect width="44" height="44" rx="8" fill="#0C447C"/>
      <ellipse cx="22" cy="21" rx="16" ry="13" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.2"/>
      <line x1="22" y1="15" x2="16" y2="15" stroke="rgba(255,255,255,0.62)" stroke-width="1.1"/>
      <line x1="22" y1="15" x2="28" y2="16" stroke="rgba(255,255,255,0.62)" stroke-width="1.1"/>
      <line x1="28" y1="16" x2="32" y2="21" stroke="rgba(255,255,255,0.62)" stroke-width="1.1"/>
      <line x1="16" y1="15" x2="16" y2="27" stroke="rgba(255,255,255,0.62)" stroke-width="1.1"/>
      <line x1="12" y1="21" x2="22" y2="15" stroke="rgba(255,255,255,0.48)" stroke-width="1.1"/>
      <line x1="16" y1="15" x2="12" y2="21" stroke="rgba(29,158,117,0.5)" stroke-width="1.1"/>
      <line class="ppc-logo-check ppc-logo-check-1" x1="12" y1="21" x2="16" y2="27" stroke="#1D9E75" stroke-width="2.6" stroke-linecap="round"/>
      <line class="ppc-logo-check ppc-logo-check-2" x1="16" y1="27" x2="28" y2="16" stroke="#1D9E75" stroke-width="2.6" stroke-linecap="round"/>
      <circle class="ppc-logo-node ppc-logo-node-1" cx="12" cy="21" r="2.7" fill="#1D9E75"/>
      <circle class="ppc-logo-node ppc-logo-node-2" cx="16" cy="27" r="3.4" fill="#1D9E75"/>
      <circle class="ppc-logo-node ppc-logo-node-3" cx="28" cy="16" r="2.7" fill="#1D9E75"/>
      <text x="56" y="27" font-family="'Playfair Display',Georgia,serif" font-size="19" font-weight="700" fill="#0C2340">Patent PreCheck<tspan font-size="10" dy="-7">&#8482;</tspan></text>
    </svg>
  </a>
  <div class="ppc-nav-links">${linksHtml}</div>
  <a href="analyze.html" class="ppc-nav-cta">Check My Work &rarr;</a>
  <button class="ppc-hamburger" aria-label="Toggle menu" aria-expanded="false" aria-controls="ppc-mobile-panel">
    <span></span>
  </button>
</nav>
<div class="ppc-mobile-panel" id="ppc-mobile-panel" role="navigation" aria-label="Mobile navigation">
  ${mobileLinksHtml}
  <a href="analyze.html" class="ppc-mobile-cta">Check My Work &rarr;</a>
</div>`;

  const footerHtml = `
<footer class="ppc-footer">
  <div style="text-align:center;padding:0 0 24px">
    <svg height="32" viewBox="0 0 160 32" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="5" fill="#0C447C"/>
      <line x1="16" y1="10" x2="11" y2="10" stroke="rgba(255,255,255,.62)" stroke-width="1"/>
      <line x1="16" y1="10" x2="21" y2="11" stroke="rgba(255,255,255,.62)" stroke-width="1"/>
      <line x1="8" y1="15" x2="16" y2="10" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
      <line class="ppc-logo-check ppc-logo-check-1" x1="8" y1="15" x2="11" y2="20" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" style="stroke-dasharray:10"/>
      <line class="ppc-logo-check ppc-logo-check-2" x1="11" y1="20" x2="21" y2="11" stroke="#1D9E75" stroke-width="2" stroke-linecap="round" style="stroke-dasharray:18"/>
      <circle class="ppc-logo-node ppc-logo-node-1" cx="8" cy="15" r="2" fill="#1D9E75"/>
      <circle class="ppc-logo-node ppc-logo-node-2" cx="11" cy="20" r="2.5" fill="#1D9E75"/>
      <circle class="ppc-logo-node ppc-logo-node-3" cx="21" cy="11" r="2" fill="#1D9E75"/>
      <text x="42" y="19" font-family="'Playfair Display',Georgia,serif" font-size="14" font-weight="700" fill="white">Patent PreCheck<tspan font-size="8" dy="-5">&#8482;</tspan></text>
    </svg>
  </div>
  <p class="ppc-footer-links">
    <a href="platform.html">The Platform</a>
    <a href="notebook.html">Inventor's Notebook</a>
    <a href="filing.html">Assisted Filing</a>
    <a href="attorneys.html">Find an Attorney</a>
    <a href="legal-intelligence.html">Legal Intelligence</a>
    <a href="privacy.html">Privacy</a>
    <a href="terms.html">Terms</a>
  </p>
  <p class="ppc-footer-copy">&copy; 2026 Patent PreCheck&trade;. All rights reserved.</p>
</footer>`;

  // Inject as soon as DOM is ready
  function inject() {
    document.body.classList.add('ppc-has-nav');

    // Replace existing nav, or prepend if missing
    const existingNav = document.querySelector('nav');
    if (existingNav) {
      existingNav.outerHTML = navHtml;
    } else {
      document.body.insertAdjacentHTML('afterbegin', navHtml);
    }

    // Wire up hamburger toggle
    const hamburger = document.querySelector('.ppc-hamburger');
    const panel = document.getElementById('ppc-mobile-panel');
    if (hamburger && panel) {
      hamburger.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });
      panel.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {
          panel.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        });
      });
      window.addEventListener('resize', () => {
        if (window.innerWidth > 760 && panel.classList.contains('open')) {
          panel.classList.remove('open');
          hamburger.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    }

    // Replace existing footer, or append if missing
    const existingFooter = document.querySelector('footer');
    if (existingFooter) {
      existingFooter.outerHTML = footerHtml;
    } else {
      document.body.insertAdjacentHTML('beforeend', footerHtml);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
