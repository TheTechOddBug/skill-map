// ============================================================
// VIDEO FACADE: click-to-load YouTube embeds
// ============================================================
// The #video section ships two cards that LOOK like embedded players
// but are just a local poster plus a play button. The real iframe is
// injected on click, and only then.
//
// Two reasons, both deliberate:
//
//   1. Privacy. A YouTube iframe sets tracking cookies the moment it
//      loads, before the visitor has agreed to anything. This site
//      asks for consent (see cookie-consent.js), so an embed that
//      phones home on page load would contradict the banner. Nothing
//      reaches Google until someone asks to watch.
//
//   2. Weight. The YouTube player pulls roughly a megabyte of
//      third-party JS. Two of them on the landing page would cost
//      more than everything else here combined, for something most
//      visitors scroll past.
//
// The card's markup is an `<a href="https://www.youtube.com/...">`, so
// with JS disabled (or if this module fails to load) the click still
// works: it just opens YouTube in a new tab. We only preventDefault
// once we know we can replace it with a player in place.
//
// Reduced-motion visitors get the same behaviour: the facade never
// animates on its own, and `autoplay=1` only fires from their click,
// which is a user gesture, not motion the page started.
// ============================================================
(() => {
  const cards = document.querySelectorAll('.js-video[data-video-id]');
  if (!cards.length) return;

  const buildIframe = (videoId, title) => {
    const iframe = document.createElement('iframe');
    // youtube-nocookie serves the same player from a domain that does
    // not set its ad-targeting cookies. It still sets a playback cookie
    // once the video starts, which is why this only runs on click.
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
    iframe.title = title;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.className = 'vcard__iframe';
    return iframe;
  };

  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      // Let modified clicks (new tab, new window, download) fall through
      // to the href untouched, the same way a normal link behaves.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

      event.preventDefault();

      const videoId = card.dataset.videoId;
      if (!videoId) return;

      const title = card.getAttribute('aria-label') || 'YouTube video player';
      card.replaceChildren(buildIframe(videoId, title));
      card.classList.add('is-playing');
      // The frame is no longer a link once the player owns it: drop the
      // role so screen readers stop announcing it as one.
      card.removeAttribute('aria-label');
      card.removeAttribute('target');
      card.removeAttribute('rel');
      card.removeAttribute('href');
    });
  });
})();
