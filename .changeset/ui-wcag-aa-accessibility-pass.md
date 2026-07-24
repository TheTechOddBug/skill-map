---
"@skill-map/cli": patch
---

Formal WCAG 2.1 AA accessibility pass over the desktop UI: async changes are announced via a shared LiveAnnouncer plus `role="alert"` on errors, a skip-to-content link bypasses the topbar, inspector sections expose heading semantics, graph nodes are keyboard-reachable and named, node selection focuses the inspector, resize separators respond to arrow keys, form errors link to inputs, and switchers use real tab semantics. Adds `@angular/cdk`. Contrast and minors deferred to a browser axe pass.

## User-facing

The desktop UI now works far better with a keyboard and screen reader: async updates are announced, a skip link jumps past the topbar, graph nodes are reachable by keyboard, and dialogs expose proper heading and tab semantics.
