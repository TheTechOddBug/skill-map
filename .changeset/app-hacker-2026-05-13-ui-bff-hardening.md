---
"@skill-map/cli": patch
---

Apply findings from the `app-hacker` security audit of `ui/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

HIGH:

- **H1 (UI half)** `ui/src/services/kind-registry.ts` now filters incoming kind names through the same `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` pattern the kernel enforces (`spec/schemas/node.schema.json`, see the paired spec changeset). A stale BFF or a future malformed envelope can no longer drive a CSS injection through the `<style id="sm-kind-vars">` tag. `applyCssVars` also wraps each entry's hex-tint derivation in a try/catch so an isolated malformed color never poisons the entire stylesheet (audit L3, covered transitively).

MEDIUM:

- **M1** Bumped `markdown-it` 14.1.0 → 14.1.1 in `ui/` to pick up the upstream ReDoS fix (GHSA-38c4-r59v-3vqw). The renderer runs against user-authored markdown bodies, so a patho­logically crafted file could previously hang the browser thread.
- **M2** Removed unused `js-yaml` and `@types/js-yaml` from `ui/`. They had no imports anywhere under `ui/src/`; deleting them shrinks the bundle attack surface and removes a future-CVE channel.

LOW:

- **L1** `ui/src/app/components/annotations-panel/annotations-panel.ts` now narrows `source` and `docsUrl` annotation values to `http(s)://` URLs via a new `httpUrlOrNull` helper before binding them to `[href]`. Angular's DomSanitizer already blocked `javascript:` in URL context; the new allowlist also keeps out `data:`, `blob:`, `file:`, and custom schemes that a curator or stale sidecar might smuggle in. The template was upgraded to `rel="noopener noreferrer"` so the destination cannot see the local skill-map referer.
- **L2** `src/server/app.ts` now sets baseline security headers on every response via a new middleware: `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. `frame-ancestors` blocks the SPA from being framed by other local pages (defence against local clickjacking from other processes, malicious `file://` pages, or browser extensions). `script-src` / `style-src` are intentionally not set yet (PrimeNG ships inline styles and the SPA bundle uses inline init scripts; locking those down requires nonce wiring through the build pipeline).

Validation: `npm run validate` green.
