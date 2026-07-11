// ============================================================
// HERO DEMO VIDEO: prefers-reduced-motion-gated autoplay
// ============================================================
// The shots hero is a looping, muted screen-capture of skill-map
// lighting up live as .md files are edited. We deliberately omit the
// `autoplay` attribute and start playback from JS only when the visitor
// has NOT asked to reduce motion, matching how hero-graph.js gates its
// animation. Reduced-motion visitors get the static poster plus native
// controls so they can opt into playing it themselves.
// ============================================================
(() => {
  const videos = document.querySelectorAll('video[data-hero-video]');
  if (!videos.length) return;

  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  const apply = (video) => {
    if (reduceMQ.matches) {
      video.controls = true;
      video.pause();
    } else {
      video.controls = false;
      // play() rejects if the browser blocks it (no gesture, tab hidden);
      // swallow it, the poster stays and nothing breaks.
      video.play().catch(() => {});
    }
  };

  videos.forEach((video) => {
    apply(video);
    reduceMQ.addEventListener('change', () => apply(video));
  });
})();
