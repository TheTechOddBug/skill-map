// ============================================================
// Hero graph: particle field (canvas 2D)
// ------------------------------------------------------------
// ~80 floating particles + violet halo under the cursor.
// Self-suspends when:
//   - the user prefers reduced motion
//   - the page is hidden (other tab, minimised), Page Visibility API
//   - the card scrolls out of view, IntersectionObserver
// DPR-aware via ResizeObserver. No external deps.
// ============================================================
(() => {
  // Card is hidden on mobile via CSS (≤767px); bail before allocating
  // particles, canvas context, and observers.
  if (window.matchMedia('(max-width: 767px)').matches) return;
  const card = document.getElementById('hero-graph');
  if (!card) return;
  const canvas = card.querySelector('.hg-particles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const N_BASE = 80; // tuned for the 1280×560 reference card; scales with area
  const HALO_R = 200;
  const ATTRACT_R = 320;
  const ATTRACT_F = 0.15; // per-frame acceleration coefficient applied at the cursor
  const TINT_R = 260;
  // Cap the canvas loop at ~30fps. rAF still wakes at the display rate,
  // but the heavy per-frame work (clear + 80 arc draws) only runs every
  // 33ms, same idea as `steps(45)` does for CSS animations.
  const FRAME_INTERVAL = 1000 / 30;
  let nextFrameT = 0;

  const reducedMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionMQ.matches;
  let cardVisible = false;
  let pageVisible = !document.hidden;
  let rafId = null;
  let W = 0, H = 0;
  let particles = [];
  const mouse = { x: -9999, y: -9999, active: false };

  function initParticles() {
    particles = [];
    const target = Math.max(20, Math.round(N_BASE * (W * H) / (1280 * 560)));
    for (let i = 0; i < target; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.08,
        r: Math.random() * 1.2 + 0.4,
        baseA: Math.random() * 0.22 + 0.10,
      });
    }
  }

  function resize() {
    const rect = card.getBoundingClientRect();
    if (rect.width === W && rect.height === H) return;
    W = rect.width; H = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function shouldRun() {
    return !reducedMotion && cardVisible && pageVisible && W > 0;
  }

  function start() {
    if (rafId != null || !shouldRun()) return;
    rafId = requestAnimationFrame(draw);
  }

  function stop() {
    if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function draw(now) {
    rafId = null;
    if (!shouldRun()) return;
    if (now < nextFrameT) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    nextFrameT = now + FRAME_INTERVAL;
    ctx.clearRect(0, 0, W, H);

    // Mouse halo (radial gradient, only when over the card).
    if (mouse.active) {
      const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, HALO_R);
      g.addColorStop(0,   'rgba(167,139,250,0.18)');
      g.addColorStop(0.4, 'rgba(124,58,237,0.06)');
      g.addColorStop(1,   'rgba(124,58,237,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mouse.x - HALO_R, mouse.y - HALO_R, HALO_R * 2, HALO_R * 2);
    }

    for (const p of particles) {
      // drift
      p.x += p.vx; p.y += p.vy;
      // wrap edges
      if (p.x < -5)      p.x = W + 5;
      else if (p.x > W + 5) p.x = -5;
      if (p.y < -5)      p.y = H + 5;
      else if (p.y > H + 5) p.y = -5;

      let a = p.baseA;
      let color = '255,255,255';

      if (mouse.active) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < ATTRACT_R * ATTRACT_R) {
          const d = Math.sqrt(d2 || 1);
          const f = (1 - d / ATTRACT_R) * ATTRACT_F;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
          if (d < TINT_R) {
            const k = 1 - d / TINT_R;
            a = Math.min(1, a + k * 0.4);
            color = '167,139,250';
          }
        }
      }

      // damping (keeps the field calm)
      p.vx *= 0.98; p.vy *= 0.98;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color},${a})`;
      ctx.fill();
    }

    rafId = requestAnimationFrame(draw);
  }

  // Visibility wiring: pause the loop in every situation where it can't
  // be seen, so it doesn't burn CPU in the background.
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    if (shouldRun()) start(); else stop();
  });
  reducedMotionMQ.addEventListener('change', (e) => {
    reducedMotion = e.matches;
    if (shouldRun()) start();
    else { stop(); ctx.clearRect(0, 0, W, H); }
  });
  const io = new IntersectionObserver(([entry]) => {
    cardVisible = entry.isIntersecting;
    if (shouldRun()) start(); else stop();
  });
  io.observe(card);

  const ro = new ResizeObserver(() => {
    resize();
    if (shouldRun()) start();
  });
  ro.observe(card);

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  });
  card.addEventListener('mouseleave', () => { mouse.active = false; });

  // Initial sizing; IntersectionObserver fires the first start().
  resize();
})();
