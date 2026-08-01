---
"@skill-map/cli": patch
---

Hardens the bundled UI per a security audit: provider manifest colors are validated at the CSS sink that binds them (degrading to the neutral fallback), the markdown renderer binds a dedicated DOMPurify instance instead of configuring the process-wide singleton, `track` and `form` join the sanitizer's forbidden tags, and the `ng serve`-only `demo` Angular configuration is renamed `dev-demo` so the deployed demo can never be pointed at it.
