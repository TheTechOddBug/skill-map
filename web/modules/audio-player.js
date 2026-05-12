// ============================================================
// Audio mini-player (NotebookLM overview)
// ------------------------------------------------------------
// Wires up #audio-player + .lp-nav__listen + .audio-player__*.
// State lives in localStorage under STORAGE_KEY:
//   { open, lastLang, speed, positions: { en: <s>, es: <s> } }
// open + speed are global (so opening behavior is consistent across
// language switches); positions are per-language (each audio is a
// different recording, so resuming should be per-track).
// ============================================================
(() => {
  const player = document.getElementById('audio-player');
  if (!player) return;
  const audio   = player.querySelector('.audio-player__el');
  const trigger = document.querySelector('[data-audio-toggle]');
  if (!audio || !trigger) return;

  const closeBtn   = player.querySelector('[data-audio-close]');
  const playBtn    = player.querySelector('[data-audio-playpause]');
  const scrubBtn   = player.querySelector('[data-audio-scrub]');
  const fillEl     = player.querySelector('.audio-player__progress-fill');
  const elapsedEl  = player.querySelector('.audio-player__elapsed');
  const totalEl    = player.querySelector('.audio-player__total');
  const speedBtn   = player.querySelector('[data-audio-speed]');

  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const STORAGE_KEY = 'skill-map.audio.v1';
  const SPEEDS = [1, 1.25, 1.5, 2];
  const I18N = {
    en: { play: 'Play', pause: 'Pause' },
    es: { play: 'Reproducir', pause: 'Pausar' },
  };
  const FALLBACK_DURATION = Number(audio.dataset.fallbackDuration) || 0;

  // The active duration we render. Prefer the browser-reported value once
  // metadata is loaded; until then (or if the file is a raw MPEG ADTS
  // stream that lacks a Xing header, which leaves duration as Infinity in
  // some browsers) fall back to the static value we hardcoded next to
  // the audio asset.
  function getDuration() {
    const d = audio.duration;
    return Number.isFinite(d) && d > 0 ? d : FALLBACK_DURATION;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch { return null; }
  }
  function saveState(patch) {
    try {
      const cur = loadState() ?? {};
      const next = { ...cur, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* localStorage may be disabled, fail silent */ }
  }

  function fmtTime(secs) {
    if (!Number.isFinite(secs) || secs < 0) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function setOpen(open) {
    // `hidden` is removed first so the transition runs the next frame.
    if (open) {
      player.hidden = false;
      requestAnimationFrame(() => { player.dataset.open = 'true'; });
    } else {
      player.dataset.open = 'false';
      // Keep `hidden` aligned with the transition end so screen readers
      // don't see an invisible-but-present element.
      setTimeout(() => {
        if (player.dataset.open === 'false') player.hidden = true;
      }, 260);
      audio.pause();
    }
    trigger.setAttribute('aria-expanded', String(open));
    saveState({ open });
  }

  function setSpeed(speed) {
    audio.playbackRate = speed;
    if (speedBtn) speedBtn.textContent = `${speed}×`;
    saveState({ speed });
  }
  function cycleSpeed() {
    const cur = audio.playbackRate || 1;
    const idx = SPEEDS.indexOf(cur);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  }

  function setPlaying(playing) {
    player.dataset.state = playing ? 'playing' : 'paused';
    playBtn.setAttribute('aria-label', playing ? I18N[lang].pause : I18N[lang].play);
  }

  function updateProgress() {
    const dur = getDuration();
    const cur = audio.currentTime;
    if (dur > 0) {
      fillEl.style.width = `${(cur / dur) * 100}%`;
      scrubBtn.setAttribute('aria-valuenow', String(Math.floor((cur / dur) * 100)));
    }
    elapsedEl.textContent = fmtTime(cur);
    totalEl.textContent = fmtTime(dur);
  }

  function seekFromClientX(clientX) {
    const dur = getDuration();
    if (dur <= 0) return;
    const rect = scrubBtn.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try { audio.currentTime = ratio * dur; }
    catch { /* seekable range may be empty if browser hasn't loaded enough, give up silently */ }
    updateProgress();
  }

  // ---- Wiring ----

  trigger.addEventListener('click', () => {
    const opening = player.dataset.open !== 'true';
    setOpen(opening);
    // Opening from the nav is an explicit "I want to listen now" intent.
    // Auto-play on open; the click counts as a user gesture so browsers
    // won't block it. Closing already pauses inside setOpen(false).
    if (opening) audio.play().catch(() => { /* network race / autoplay edge, ignore */ });
  });

  closeBtn.addEventListener('click', () => setOpen(false));

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play().catch(() => { /* autoplay/network race, ignore */ });
    else audio.pause();
  });

  speedBtn?.addEventListener('click', cycleSpeed);

  scrubBtn.addEventListener('click', (e) => seekFromClientX(e.clientX));
  scrubBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const delta = e.key === 'ArrowLeft' ? -5 : 5;
    const dur = getDuration();
    try { audio.currentTime = Math.max(0, Math.min(dur || 0, audio.currentTime + delta)); }
    catch { /* see seekFromClientX */ }
    updateProgress();
    e.preventDefault();
  });

  audio.addEventListener('play',          () => setPlaying(true));
  audio.addEventListener('pause',         () => setPlaying(false));
  audio.addEventListener('ended',         () => { setPlaying(false); saveState({ positions: { ...(loadState()?.positions ?? {}), [lang]: 0 } }); });
  audio.addEventListener('loadedmetadata', () => { updateProgress(); });
  audio.addEventListener('durationchange',  () => { updateProgress(); });
  audio.addEventListener('timeupdate', () => {
    updateProgress();
    // Throttle persistence to once a second so we don't hammer
    // localStorage during playback.
    const now = performance.now();
    if (now - (audio._lastSave ?? 0) > 1000) {
      audio._lastSave = now;
      const positions = { ...(loadState()?.positions ?? {}), [lang]: audio.currentTime };
      saveState({ positions, lastLang: lang });
    }
  });

  // Pause the audio when the page becomes hidden so it doesn't keep
  // playing in a backgrounded tab the user has forgotten about. We
  // don't auto-resume on visibilitychange; let the user decide.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !audio.paused) audio.pause();
  });

  // ---- Initial state ----

  const state = loadState();
  if (state?.speed && SPEEDS.includes(state.speed)) setSpeed(state.speed);
  else setSpeed(1);

  const savedPos = state?.positions?.[lang];
  if (Number.isFinite(savedPos) && savedPos > 0) {
    // Wait for metadata before seeking; currentTime won't apply otherwise.
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = savedPos; }, { once: true });
  }

  if (state?.open) setOpen(true);
  setPlaying(false);

  // Paint the initial state so the user sees the total duration and a
  // 0% fill before any media event fires. updateProgress() is safe to
  // call before metadata is loaded; it falls back to FALLBACK_DURATION.
  updateProgress();
})();
