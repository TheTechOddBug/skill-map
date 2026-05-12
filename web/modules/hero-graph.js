// ============================================================
// Hero graph: selection + drag + inspector + physics
// ============================================================
// Selection + drag + inspector card for the hero `#hero-graph`
// SVG. Coulomb-repulsion + spring physics drift nodes back to
// their home positions while edges keep them connected.

(() => {
  // ============================================================
  // Hero graph: selection + drag + inspector
  // ============================================================
  // The card is `display: none` below 768px (see styles.css; 768 inclusive
  // shows the graph). Skip the whole init on mobile; saves event listener
  // registration, adjacency map build, and inspector wiring on a card the
  // user can't see.
  if (window.matchMedia('(max-width: 767px)').matches) return;
  const graphCard = document.getElementById('hero-graph');
  if (!graphCard) return;
  const svg = graphCard.querySelector('.hero__graph-svg');
  if (!svg) return;

  const TYPE_COLOR = {
    skill:   '#00C853',
    agent:   '#7C3AED',
    command: '#4C1D95',
    hook:    '#A78BFA',
    markdown: '#8A93A1',
    orphan:  '#5A6472',
  };

  // Graph chrome strings stay in English in both locales; the audience is
  // devs, not mathematicians, and the localized labels read awkward.
  const STR = {
    skill: 'SKILL', agent: 'AGENT', command: 'COMMAND', hook: 'HOOK', markdown: 'MARKDOWN', orphan: 'ORPHAN',
    refs: 'refs', tokens: 'tokens', bytes: 'bytes', lastscan: 'last scan',
    'warn.collision': 'references 5 skills, 1 collides',
    'warn.orphan':    'no inbound references, never invoked',
  };
  const t = (k) => STR[k] ?? k;
  const formatAgo = (raw) => `${raw} ago`;

  // Build adjacency map from edges in the DOM.
  const edges = Array.from(svg.querySelectorAll('.edge'));
  const adj = new Map();
  for (const e of edges) {
    const a = e.dataset.from, b = e.dataset.to;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }

  const nodes = Array.from(svg.querySelectorAll('.node'));
  const nodeById = new Map(nodes.map((n) => [n.dataset.id, n]));

  // Read each node's current position from its transform="translate(x,y)".
  const nodePos = new Map();
  function readPos(g) {
    const m = /translate\(\s*([-0-9.]+)[ ,]\s*([-0-9.]+)\s*\)/.exec(g.getAttribute('transform') || '');
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  }
  for (const n of nodes) nodePos.set(n.dataset.id, readPos(n));

  // Index edges by endpoint for O(1) updates on drag.
  const edgesByEndpoint = new Map();
  for (const e of edges) {
    for (const id of [e.dataset.from, e.dataset.to]) {
      if (!edgesByEndpoint.has(id)) edgesByEndpoint.set(id, []);
      edgesByEndpoint.get(id).push(e);
    }
  }

  const viewport = svg.querySelector('.hg-viewport');
  const selectFx = svg.querySelector('.select-fx');
  let selectFxG = null;
  let selected = 'reviewer';
  const travelers = new Map(); // edge element → traveler <circle>

  // Inspector panel: created once, updated on selection.
  const inspector = document.createElement('div');
  inspector.className = 'hero__inspector';
  inspector.innerHTML = `
    <div class="hero__inspector__type">
      <span class="hero__inspector__dot"></span>
      <span class="hero__inspector__type-label"></span>
    </div>
    <div class="hero__inspector__name"></div>
    <div class="hero__inspector__path"></div>
    <div class="hero__inspector__rows">
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('refs'))}</span>     <span class="v" data-k="refs"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('tokens'))}</span>   <span class="v" data-k="tokens"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('bytes'))}</span>    <span class="v" data-k="bytes"></span></div>
      <div class="hero__inspector__row"><span class="k">${escapeHtml(t('lastscan'))}</span> <span class="v" data-k="lastscan"></span></div>
    </div>
    <div class="hero__inspector__warn" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9"  x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span class="hero__inspector__warn-text"></span>
    </div>
  `;
  graphCard.appendChild(inspector);

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function updateInspector() {
    const node = nodeById.get(selected);
    if (!node) { inspector.hidden = true; return; }
    inspector.hidden = false;
    const type = node.dataset.type;
    const name = node.querySelector('.node-label')?.textContent ?? selected;
    const color = TYPE_COLOR[type] ?? '#fff';

    inspector.style.borderColor = `${color}55`;
    inspector.style.boxShadow = `0 0 0 1px ${color}22, 0 20px 50px rgba(0,0,0,.5)`;
    inspector.style.setProperty('--type-color', color);

    inspector.querySelector('.hero__inspector__type-label').textContent = t(type);
    inspector.querySelector('.hero__inspector__name').textContent = name;
    inspector.querySelector('.hero__inspector__path').textContent = `${type}s/${name}.md`;

    inspector.querySelector('[data-k="refs"]').textContent     = String(adj.get(selected)?.size ?? 0);
    inspector.querySelector('[data-k="tokens"]').textContent   = node.dataset.tokens   ?? '-';
    inspector.querySelector('[data-k="bytes"]').textContent    = node.dataset.bytes    ?? '-';
    inspector.querySelector('[data-k="lastscan"]').textContent = node.dataset.lastscan ? formatAgo(node.dataset.lastscan) : '-';

    const warn = inspector.querySelector('.hero__inspector__warn');
    const warnKey = node.dataset.warn;
    if (warnKey) {
      warn.hidden = false;
      inspector.querySelector('.hero__inspector__warn-text').textContent = t(warnKey);
    } else {
      warn.hidden = true;
    }
  }

  // Recompute highlight state for ALL nodes/edges. Only call this when
  // `selected` changes, NOT on hover. Hover is local: only the entered
  // node toggles its own data-hover.
  function applyHighlight() {
    const neighbors = adj.get(selected) ?? new Set();
    for (const n of nodes) {
      const id = n.dataset.id;
      const isSel = id === selected;
      const isHi  = isSel || neighbors.has(id);
      n.dataset.selected = String(isSel);
      n.dataset.dim      = String(selected ? !isHi : false);
      n.style.setProperty('--type-color', TYPE_COLOR[n.dataset.type] ?? '#fff');
    }
    for (const e of edges) {
      const isHi = e.dataset.from === selected || e.dataset.to === selected;
      e.dataset.hi  = String(isHi);
      e.dataset.dim = String(selected ? !isHi : false);
    }
    buildSelectFx();
  }

  // Build the pulsing ring for the selected node. Uses a translated <g> so
  // its inner <circle> sits at (0,0); CSS animates `transform: scale()` on
  // the circle (compositor-only). Avoids SMIL's per-frame attribute
  // mutation, which re-rasterizes the SVG.
  //
  // Split into two functions so drag (which fires every pointermove) can
  // call the cheap `setSelectFxPos` instead of rebuilding DOM each frame.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function buildSelectFx() {
    while (selectFx.firstChild) selectFx.removeChild(selectFx.firstChild);
    selectFxG = null;
    travelers.clear();
    const node = nodeById.get(selected);
    if (!node) return;
    const r = +node.querySelector('circle').getAttribute('r');
    const color = TYPE_COLOR[node.dataset.type] ?? '#fff';

    const g = document.createElementNS(SVG_NS, 'g');

    const solid = document.createElementNS(SVG_NS, 'circle');
    solid.setAttribute('cx', '0'); solid.setAttribute('cy', '0');
    solid.setAttribute('r', String(r + 6));
    solid.setAttribute('fill', 'none');
    solid.setAttribute('stroke', color);
    solid.setAttribute('stroke-width', '2');
    solid.setAttribute('opacity', '.7');
    g.appendChild(solid);

    const pulse = document.createElementNS(SVG_NS, 'circle');
    pulse.setAttribute('class', 'select-fx-pulse');
    pulse.setAttribute('cx', '0'); pulse.setAttribute('cy', '0');
    pulse.setAttribute('r', String(r + 8));
    pulse.setAttribute('fill', 'none');
    pulse.setAttribute('stroke', color);
    pulse.setAttribute('stroke-width', '1.5');
    g.appendChild(pulse);

    selectFx.appendChild(g);
    selectFxG = g;
    setSelectFxPos();

    // Traveling pulses on connected edges. Stagger their start so they
    // don't all fire in unison; looks more alive, same total cost.
    let i = 0;
    for (const e of edges) {
      if (e.dataset.from !== selected && e.dataset.to !== selected) continue;
      const tr = document.createElementNS(SVG_NS, 'circle');
      tr.setAttribute('class', 'hg-traveler');
      tr.setAttribute('cx', '0'); tr.setAttribute('cy', '0');
      tr.setAttribute('r', '3');
      tr.setAttribute('fill', '#A78BFA');
      tr.style.animationDelay = `${(i++ * 180) % 1400}ms`;
      selectFx.appendChild(tr);
      travelers.set(e, tr);
      updateTravelerPath(e);
    }
  }
  function setSelectFxPos() {
    if (!selectFxG) return;
    const pos = nodePos.get(selected);
    if (!pos) return;
    selectFxG.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
  }
  function updateTravelerPath(edge) {
    const tr = travelers.get(edge);
    if (!tr) return;
    const x1 = edge.getAttribute('x1');
    const y1 = edge.getAttribute('y1');
    const x2 = edge.getAttribute('x2');
    const y2 = edge.getAttribute('y2');
    tr.style.offsetPath = `path('M ${x1} ${y1} L ${x2} ${y2}')`;
  }

  // Convert client (screen) coords to viewport-local coords. Uses the
  // viewport's CTM so zoom/pan are accounted for automatically; drag
  // continues to work when k != 1 or (x,y) != (0,0).
  function clientToViewport(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = viewport.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: clientX, y: clientY };
  }

  function moveNodeTo(id, x, y) {
    nodePos.set(id, { x, y });
    const g = nodeById.get(id);
    if (g) g.setAttribute('transform', `translate(${x}, ${y})`);
    const conn = edgesByEndpoint.get(id);
    if (conn) {
      for (const e of conn) {
        if (e.dataset.from === id) { e.setAttribute('x1', x); e.setAttribute('y1', y); }
        if (e.dataset.to   === id) { e.setAttribute('x2', x); e.setAttribute('y2', y); }
        updateTravelerPath(e);
      }
    }
    if (id === selected) setSelectFxPos();
  }

  // ---------- Zoom + pan ----------
  const view = { x: 0, y: 0 };
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x} ${view.y})`);
  }

  let panning = null;

  // Pointer interactions per node: drag, click-as-select, hover.
  let dragging = null; // { id, dx, dy, moved }

  for (const node of nodes) {
    // Hover is local: toggle data-hover only on the entered node so the
    // browser doesn't recompute styles on the other 12.
    node.addEventListener('pointerenter', () => { node.dataset.hover = 'true'; });
    node.addEventListener('pointerleave', () => { delete node.dataset.hover;  });

    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = node.dataset.id;
      const pos = nodePos.get(id);
      const p = clientToViewport(e.clientX, e.clientY);
      dragging = { id, dx: pos.x - p.x, dy: pos.y - p.y, moved: 0 };
      node.dataset.dragging = 'true';
      node.setPointerCapture?.(e.pointerId);
    });
  }

  // Bg pan: pointerdown anywhere on the SVG that isn't a node.
  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add('is-panning');
    svg.setPointerCapture?.(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (panning) {
      view.x = panning.vx + (e.clientX - panning.sx);
      view.y = panning.vy + (e.clientY - panning.sy);
      applyView();
      return;
    }
    if (!dragging) return;
    const p = clientToViewport(e.clientX, e.clientY);
    const nx = p.x + dragging.dx;
    const ny = p.y + dragging.dy;
    const prev = nodePos.get(dragging.id);
    dragging.moved += Math.hypot(nx - prev.x, ny - prev.y);
    moveNodeTo(dragging.id, nx, ny);
  });

  function endDrag() {
    if (panning) {
      panning = null;
      svg.classList.remove('is-panning');
    }
    if (!dragging) return;
    const { id, moved } = dragging;
    const node = nodeById.get(id);
    if (node) delete node.dataset.dragging;
    if (moved < 4) {
      selected = id;
      updateInspector();
      applyHighlight();
    }
    dragging = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // Initial paint.
  updateInspector();
  applyHighlight();

  // ============================================================
  // Physics: Coulomb repulsion + spring on edges + drift to home
  // ------------------------------------------------------------
  // Lives inside the same IIFE so it can call moveNodeTo() and read
  // nodePos directly. Ported from web/tmp/hero-graph.jsx.
  //
  // Self-suspends on prefers-reduced-motion / page hidden / card out
  // of viewport (same pattern as the particle field).
  //
  // n = 13 nodes → n² = 169 force ops per frame, plus per-node spring
  // pass on edges. Trivially within budget on the GPU side; the cost
  // is the 13 setAttribute('transform') calls per frame in moveNodeTo,
  // which the compositor handles cheaply because each .node has its
  // own GPU layer (will-change: transform).
  // ============================================================
  const VIEW_W = 900, VIEW_H = 560;
  const EDGE_TARGET = 130;
  const REPULSE_K   = 4500;
  const SPRING_K    = 0.06;
  const DRIFT_K     = 0.6;
  const DAMPING     = 0.82;
  const VMAX        = 50;
  const MARGIN      = 60;
  // 30fps cap. Same approach as the particle field: rAF wakes at the
  // display rate but the n² + setAttribute work only runs every 33ms.
  const PHYS_FRAME_INTERVAL = 1000 / 30;
  let physNextT = 0;

  // Per-node physics state (velocity + home + breathing wobble seed).
  const phys = new Map();
  for (const [id, p] of nodePos) {
    phys.set(id, {
      vx: 0, vy: 0,
      px: p.x, py: p.y,             // home position (drift target)
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.4,
    });
  }

  // Pre-index edges as numeric pairs for the spring pass.
  const idxOf = new Map(Array.from(nodeById.keys()).map((id, i) => [id, i]));
  const idsByIdx = Array.from(nodeById.keys());
  const edgePairs = edges.map((e) => ({
    a: idxOf.get(e.dataset.from),
    b: idxOf.get(e.dataset.to),
  }));

  const physReducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let physReduced  = physReducedMQ.matches;
  let physVisible  = false;
  let physPageOK   = !document.hidden;
  let physRaf      = null;
  let physLastT    = 0;

  function physShould() {
    return !physReduced && physVisible && physPageOK;
  }
  function physStart() {
    if (physRaf != null || !physShould()) return;
    physLastT = performance.now();
    physRaf = requestAnimationFrame(physStep);
  }
  function physStop() {
    if (physRaf != null) { cancelAnimationFrame(physRaf); physRaf = null; }
  }

  function physStep(now) {
    physRaf = null;
    if (!physShould()) return;
    if (now < physNextT) {
      physRaf = requestAnimationFrame(physStep);
      return;
    }
    physNextT = now + PHYS_FRAME_INTERVAL;
    const dt = Math.min(0.06, (now - physLastT) / 1000);
    physLastT = now;
    const time = now / 1000;

    // Snapshot positions into arrays for tight inner loops.
    const N = idsByIdx.length;
    const xs = new Float32Array(N), ys = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = nodePos.get(idsByIdx[i]);
      xs[i] = p.x; ys[i] = p.y;
    }
    const fxArr = new Float32Array(N), fyArr = new Float32Array(N);
    const draggedId = dragging?.id;

    // 1. pairwise repulsion (Coulomb-ish)
    for (let i = 0; i < N; i++) {
      if (idsByIdx[i] === draggedId) continue;
      let fx = 0, fy = 0;
      const ax = xs[i], ay = ys[i];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = ax - xs[j];
        const dy = ay - ys[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const d = Math.sqrt(d2);
        const f = REPULSE_K / d2;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      fxArr[i] = fx; fyArr[i] = fy;
    }

    // 2. spring forces along edges
    for (const e of edgePairs) {
      if (e.a == null || e.b == null) continue;
      const dx = xs[e.b] - xs[e.a];
      const dy = ys[e.b] - ys[e.a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = d - EDGE_TARGET;
      const fx = (dx / d) * stretch * SPRING_K * 60;
      const fy = (dy / d) * stretch * SPRING_K * 60;
      if (idsByIdx[e.a] !== draggedId) { fxArr[e.a] += fx; fyArr[e.a] += fy; }
      if (idsByIdx[e.b] !== draggedId) { fxArr[e.b] -= fx; fyArr[e.b] -= fy; }
    }

    // 3. drift to home + soft bounds + breathing wobble + integrate
    for (let i = 0; i < N; i++) {
      const id = idsByIdx[i];
      if (id === draggedId) continue;
      const ph = phys.get(id);
      let fx = fxArr[i], fy = fyArr[i];

      // drift to home
      fx += (ph.px - xs[i]) * DRIFT_K;
      fy += (ph.py - ys[i]) * DRIFT_K;

      // soft bounds (push away from edges)
      if (xs[i] < MARGIN)             fx += (MARGIN - xs[i]) * 2;
      if (xs[i] > VIEW_W - MARGIN)    fx -= (xs[i] - (VIEW_W - MARGIN)) * 2;
      if (ys[i] < MARGIN + 40)        fy += (MARGIN + 40 - ys[i]) * 2; // top bar room
      if (ys[i] > VIEW_H - MARGIN)    fy -= (ys[i] - (VIEW_H - MARGIN)) * 2;

      // breathing wobble (sine per node)
      fx += Math.cos(time * ph.speed + ph.phase) * 6;
      fy += Math.sin(time * ph.speed * 1.3 + ph.phase) * 6;

      // integrate with damping
      ph.vx = (ph.vx + fx * dt) * DAMPING;
      ph.vy = (ph.vy + fy * dt) * DAMPING;

      // velocity cap
      const vmag = Math.hypot(ph.vx, ph.vy);
      if (vmag > VMAX) { ph.vx *= VMAX / vmag; ph.vy *= VMAX / vmag; }

      const nx = xs[i] + ph.vx * dt;
      const ny = ys[i] + ph.vy * dt;
      moveNodeTo(id, nx, ny);
    }

    physRaf = requestAnimationFrame(physStep);
  }

  // Visibility wiring (mirrors the particle field).
  document.addEventListener('visibilitychange', () => {
    physPageOK = !document.hidden;
    if (physShould()) physStart(); else physStop();
  });
  physReducedMQ.addEventListener('change', (e) => {
    physReduced = e.matches;
    if (physShould()) physStart(); else physStop();
  });
  const physIO = new IntersectionObserver(([entry]) => {
    physVisible = entry.isIntersecting;
    if (physShould()) physStart(); else physStop();
  });
  physIO.observe(graphCard);
})();
