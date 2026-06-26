---
"@skill-map/cli": patch
---

Updated UI dependencies to close the advisories from the UI security audit. Angular moves to 21.2.17 (the XSS sanitizer-bypass fixes) and `dompurify` to 3.4.11; a pnpm-workspace override forces `posthog-js`'s bundled `dompurify` to the same 3.4.11 so the shipped bundle no longer carries a vulnerable copy. `@sentry/angular`, `markdown-it`, `posthog-js`, `primeng`, and `vitest` also move to current patches.
