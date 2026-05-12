// ============================================================
// Click-to-copy with toast
// ------------------------------------------------------------
// Any element with class `js-copy` is a copy trigger. The text
// to copy comes from `data-copy` (preferred) or textContent. On
// success we surface a small bottom-center toast; on failure we
// fall back to a hidden-textarea selection + execCommand, and as
// a last resort tell the user to press the OS copy combo.
// Vanilla, no dependency.
// ============================================================
(() => {
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
  const MSG = {
    en: { ok: 'Copied to clipboard', err: 'Press ⌘C / Ctrl+C to copy' },
    es: { ok: 'Copiado al portapapeles', err: 'Presioná ⌘C / Ctrl+C para copiar' },
  };

  let toast = null;
  let timer = null;

  function ensureToast() {
    if (toast) return toast;
    toast = document.createElement('div');
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    return toast;
  }

  function showToast(message, kind = 'ok') {
    const t = ensureToast();
    t.classList.toggle('copy-toast--err', kind === 'err');
    const iconOk = '<polyline points="20 6 9 17 4 12"/>';
    const iconErr = '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/>';
    t.innerHTML = `
      <svg class="copy-toast__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${kind === 'err' ? iconErr : iconOk}
      </svg>
      <span></span>
    `;
    t.querySelector('span').textContent = message;
    t.classList.add('copy-toast--show');
    clearTimeout(timer);
    timer = setTimeout(() => t.classList.remove('copy-toast--show'), 2000);
  }

  async function copyText(text) {
    // Modern path: navigator.clipboard (HTTPS / localhost only).
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    // Legacy fallback: hidden textarea + execCommand.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  document.addEventListener('click', async (e) => {
    const trigger = e.target.closest('.js-copy');
    if (!trigger) return;
    const text = trigger.dataset.copy || trigger.textContent.trim();
    const ok = await copyText(text);
    showToast(ok ? MSG[lang].ok : MSG[lang].err, ok ? 'ok' : 'err');
  });
})();
