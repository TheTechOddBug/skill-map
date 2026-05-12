// ============================================================
// SCREENSHOT LIGHTBOX — native <dialog> with local pinch-zoom + pan
// ============================================================
// Click/tap on a `[data-lightbox-open]` button copies its inner <img>
// src/alt into the dialog's img and calls showModal(). Backdrop click,
// the close button, and Escape (native) all close.
//
// Pinch-zoom is implemented locally (only the image scales, not the page).
// Two fingers on the image: scale 1x–5x, anchored to the gesture midpoint.
// One finger when zoomed > 1: pan. Closing resets the transform.
// `touch-action: none` on .lightbox__img blocks the browser's native page-
// zoom so it doesn't compete with our handlers.
// ============================================================
(() => {
  const dialog = document.querySelector('[data-lightbox]');
  if (!dialog) return;
  const dialogImg = dialog.querySelector('.lightbox__img');
  const closeBtn = dialog.querySelector('[data-lightbox-close]');
  if (!dialogImg || !closeBtn) return;

  const triggers = document.querySelectorAll('[data-lightbox-open]');
  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sourceImg = btn.querySelector('img');
      if (!sourceImg) return;
      dialogImg.src = sourceImg.currentSrc || sourceImg.src;
      dialogImg.alt = sourceImg.alt || '';
      dialog.showModal();
    });
  });

  closeBtn.addEventListener('click', () => dialog.close());

  // Click on the backdrop area (target === dialog itself, not its
  // children) closes the lightbox. Standard <dialog> idiom.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // ---------- Pinch-zoom + pan ----------
  // Transform state. `tx/ty` translate the image's center; `scale` magnifies.
  // Composed as `translate(tx, ty) scale(scale)` — order matters: translate
  // first so the gesture-midpoint pinning math stays linear.
  const MIN_SCALE = 1;
  const MAX_SCALE = 5;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  // Gesture state. `gesture` is the active mode: null, 'pinch', or 'pan'.
  // For pinch we remember the initial finger distance + midpoint; for pan
  // we remember the starting touch position and the translate at start.
  // `imgCx/imgCy` is the image's untransformed center in client coords,
  // captured once per pinch — the anchor math needs a stable reference
  // that doesn't drift as we keep applying transforms frame to frame.
  let gesture = null;
  let startDist = 0;
  let startScale = 1;
  let startTx = 0;
  let startTy = 0;
  let startCx = 0;
  let startCy = 0;
  let imgCx = 0;
  let imgCy = 0;

  function applyTransform() {
    dialogImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  function resetTransform() {
    scale = 1;
    tx = 0;
    ty = 0;
    dialogImg.style.transform = '';
  }
  function midpoint(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }
  function distance(touches) {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  dialogImg.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      gesture = 'pinch';
      startDist = distance(e.touches);
      startScale = scale;
      const mid = midpoint(e.touches);
      startCx = mid.x;
      startCy = mid.y;
      startTx = tx;
      startTy = ty;
      // Capture the untransformed image center: BCR is the *transformed*
      // rect, but with `transform-origin: 50% 50%` the scale doesn't shift
      // the center — only the translate does. Subtracting startTx/startTy
      // recovers the laid-out center, which stays valid for the whole
      // gesture regardless of how many move events fire.
      const rect = dialogImg.getBoundingClientRect();
      imgCx = rect.left + rect.width / 2 - startTx;
      imgCy = rect.top + rect.height / 2 - startTy;
      e.preventDefault();
    } else if (e.touches.length === 1 && scale > 1) {
      gesture = 'pan';
      startCx = e.touches[0].clientX;
      startCy = e.touches[0].clientY;
      startTx = tx;
      startTy = ty;
      e.preventDefault();
    }
  }, { passive: false });

  dialogImg.addEventListener('touchmove', (e) => {
    if (gesture === 'pinch' && e.touches.length === 2) {
      const ratio = distance(e.touches) / startDist;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale * ratio));
      // Keep the midpoint anchored: as scale changes, translate so the
      // pixel under the midpoint stays under the (moving) midpoint.
      // Derived from `clientX = imgCx + tx + scale * dx` where `dx` is the
      // pixel's image-space offset from center; solve for the new tx that
      // keeps the same `dx` under the current midpoint.
      const mid = midpoint(e.touches);
      const k = newScale / startScale;
      tx = mid.x - imgCx - k * (startCx - imgCx - startTx);
      ty = mid.y - imgCy - k * (startCy - imgCy - startTy);
      scale = newScale;
      applyTransform();
      e.preventDefault();
    } else if (gesture === 'pan' && e.touches.length === 1) {
      tx = startTx + (e.touches[0].clientX - startCx);
      ty = startTy + (e.touches[0].clientY - startCy);
      applyTransform();
      e.preventDefault();
    }
  }, { passive: false });

  dialogImg.addEventListener('touchend', (e) => {
    // Pinch released → if we ended below 1x (shouldn't, MIN_SCALE clamps),
    // or if the user lifted the second finger, snap back when scale ≤ 1.
    if (e.touches.length < 2) {
      if (scale <= MIN_SCALE + 0.01) resetTransform();
      gesture = e.touches.length === 1 ? 'pan' : null;
      if (gesture === 'pan') {
        startCx = e.touches[0].clientX;
        startCy = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
      }
    }
    if (e.touches.length === 0) gesture = null;
  });

  // Clean up transform whenever the dialog closes (Escape, close button,
  // backdrop click, or any future code path) so the next open starts fresh.
  dialog.addEventListener('close', resetTransform);
})();
