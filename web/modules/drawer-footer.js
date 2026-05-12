// ============================================================
// Footer → mobile drawer migration
// ------------------------------------------------------------
// On phones (≤767px) the footer is hidden by CSS and its content
// (link columns + bottom strip) is moved into the nav drawer so
// the user reaches every link from a single overlay. On desktop
// the original DOM is restored. Brand block stays in the footer
// because the nav already shows the logo on every page.
// ============================================================
(() => {
  const drawer = document.getElementById('nav-drawer');
  const footer = document.querySelector('.lp-footer');
  if (!drawer || !footer) return;

  // Only the link columns migrate. The bottom strip (copyright + Makersia
   // attribution) stays in the footer at every viewport — it carries the
   // author / license signal and must remain visible on the page itself.
  const movable = [
    ...footer.querySelectorAll('.lp-footer__col'),
  ];
  if (movable.length === 0) return;

  // Stable destination inside the drawer. Only created once; the JS toggles
  // its children via DOM moves rather than rebuilding it on each viewport
  // change so listeners on inner anchors stay attached.
  const slot = document.createElement('div');
  slot.className = 'lp-nav__footer-mobile';
  drawer.appendChild(slot);

  // Comment placeholders mark where each node lives in the footer so we can
  // put it back when returning to desktop, regardless of how the surrounding
  // markup has changed in the meantime.
  const anchors = movable.map((node) => {
    const placeholder = document.createComment('footer-slot');
    node.parentNode.insertBefore(placeholder, node);
    return { node, placeholder };
  });

  const apply = (mobile) => {
    if (mobile) {
      for (const { node } of anchors) slot.appendChild(node);
    } else {
      for (const { node, placeholder } of anchors) {
        placeholder.parentNode.insertBefore(node, placeholder);
      }
    }
  };

  const mq = window.matchMedia('(max-width: 767px)');
  apply(mq.matches);
  mq.addEventListener('change', (e) => apply(e.matches));
})();
