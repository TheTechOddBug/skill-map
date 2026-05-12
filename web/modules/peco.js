// ============================================================
// Plugin ecosystem — interactive satellites + brief panel
// ------------------------------------------------------------
// Six plugin kinds orbit the kernel. Hover or focus highlights a
// satellite; clicking pins it. The active id lives on
// `.peco[data-active]` so CSS routes visibility from there. The
// accent color of the active plugin is exposed as `--pe-accent`
// on the section root so the panel themes itself. Hover updates
// the visual highlight but does not change the active id.
// ============================================================
(() => {
  const root = document.querySelector('.peco');
  if (!root) return;

  const sats = [...root.querySelectorAll('.peco__sat')];
  if (!sats.length) return;
  const ids = sats.map((s) => s.dataset.peId);
  const accentOf = Object.fromEntries(sats.map((s) => [s.dataset.peId, s.dataset.peAccent]));

  function setActive(id) {
    if (!ids.includes(id)) return;
    root.dataset.active = id;
    root.style.setProperty('--pe-accent', accentOf[id]);
    const i = ids.indexOf(id);
    const counter = root.querySelector('.peco__nav-i');
    if (counter) counter.textContent = String(i + 1);
  }

  for (const sat of sats) {
    sat.addEventListener('click', () => setActive(sat.dataset.peId));
    sat.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setActive(sat.dataset.peId);
    });
    sat.addEventListener('focus', () => setActive(sat.dataset.peId));
  }

  root.querySelector('[data-pe-nav="prev"]')?.addEventListener('click', () => {
    const i = ids.indexOf(root.dataset.active);
    setActive(ids[(i - 1 + ids.length) % ids.length]);
  });
  root.querySelector('[data-pe-nav="next"]')?.addEventListener('click', () => {
    const i = ids.indexOf(root.dataset.active);
    setActive(ids[(i + 1) % ids.length]);
  });

  // Initial paint — keeps the count and accent in sync with the
  // `data-active` already declared in the HTML.
  setActive(root.dataset.active || ids[0]);
})();
