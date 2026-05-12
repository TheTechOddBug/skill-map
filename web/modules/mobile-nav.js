// ============================================================
// Mobile nav drawer
// ============================================================
// Wires `.lp-nav__toggle` + `#nav-drawer`:
//   - click toggle opens/closes
//   - tap on any drawer link closes
//   - Escape closes (and refocuses the toggle)
//   - viewport widens past mobile → close (defensive)

(() => {
  const toggle = document.querySelector('.lp-nav__toggle');
  const drawer = document.getElementById('nav-drawer');
  if (!toggle || !drawer) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    drawer.dataset.open = String(open);
    document.body.classList.toggle('is-nav-open', open);
  };

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
  });
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.dataset.open === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  const mq = window.matchMedia('(min-width: 769px)');
  mq.addEventListener('change', (e) => { if (e.matches) setOpen(false); });
})();
