// ============================================================
// Cookie consent + Google Analytics gating
// ------------------------------------------------------------
// Shows the consent dialog the first time the page loads (no
// `cookieConsent` entry in localStorage). Accept → load GA and
// remember. Decline → remember refusal, GA never loads.
// To re-prompt the user (e.g., a "Cookie preferences" link in
// the footer), call `window.smCookieConsent.reset()`.
// ============================================================
(() => {
  const dialog = document.querySelector('[data-cookie-consent]');
  if (!dialog) return;

  const KEY = 'cookieConsent';
  const GA_ID = 'G-XWJCEH8R9T';

  const stored = localStorage.getItem(KEY);

  // Auto-load analytics on subsequent visits if the user already accepted.
  if (stored === 'accepted') loadAnalytics();

  // First visit: show the dialog. showModal() gives focus trap + Escape
  // handling for free; we don't bind Escape ourselves because we *want*
  // Escape to close the dialog without persisting either choice (the
  // user can still see it on next page load).
  if (!stored && typeof dialog.showModal === 'function') {
    // Defer one tick so any data-i18n pass that ran on DOMContentLoaded
    // has already updated the dialog's text content.
    queueMicrotask(() => dialog.showModal());
  }

  dialog.querySelector('[data-cookie-accept]')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'accepted');
    loadAnalytics();
    dialog.close();
  });
  dialog.querySelector('[data-cookie-decline]')?.addEventListener('click', () => {
    localStorage.setItem(KEY, 'declined');
    dialog.close();
  });

  // Public hook for re-prompting (e.g. footer link). Mounted on window so
  // markup can wire `onclick="smCookieConsent.reset()"` without imports.
  window.smCookieConsent = {
    reset: () => {
      localStorage.removeItem(KEY);
      if (typeof dialog.showModal === 'function') dialog.showModal();
    },
  };

  // CLI version is fetched at runtime from npm because the site doesn't
  // ship the CLI binary; the footer tag reflects "currently published on
  // npm", not anything baked at build time (which is the right tradeoff
  // for spec/web, but inverted for cli). Best-effort: if the registry is
  // unreachable, the placeholder text stays.
  //
  // Hits the package metadata endpoint (not /latest, which is unreliable
  // for scoped packages) and reads `dist-tags.latest`.
  (async () => {
    const tag = document.querySelector('[data-cli-version]');
    if (!tag) return;
    try {
      const res = await fetch('https://registry.npmjs.org/@skill-map/cli', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn('[cli-version] registry returned', res.status);
        return;
      }
      const data = await res.json();
      const version = data?.['dist-tags']?.latest;
      if (typeof version === 'string') {
        tag.textContent = `cli v${version}`;
      } else {
        console.warn('[cli-version] no dist-tags.latest in response', data);
      }
    } catch (err) {
      console.warn('[cli-version] fetch failed', err);
    }
  })();

  function loadAnalytics() {
    // Standard gtag.js loader. The async script registers gtag globally;
    // the inline initializer queues the page_view event for the current
    // session.
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    gtag('js', new Date());
    gtag('config', GA_ID);
  }
})();
