---
"@skill-map/cli": patch
---

Surface the project path under the brand mark in the topbar.

The topbar already rendered a small caption under `skill-map` showing the last segment of the scanned root (for example `local-scope` when scanning `fixtures/local-scope/`). When the scan root is `.` — the common case where the CLI runs from the project directory — the caption collapsed to an empty string and the row disappeared, hiding any indication of *which* project the BFF is talking to.

The shell now fetches `/api/health` on boot and uses its `cwd` (the absolute, tilde-anonymised project root) as the caption, falling back to `scan.roots[0]` for the demo bundle where `health.cwd` may not be meaningful. The caption shows the full path verbatim so testers and screenshot reviewers can identify the project at a glance.

The topbar also adds a small `margin-top` between the wordmark and the caption so the two lines breathe.

Internal: the "update available" chip in the topbar is now gated on Angular's `isDevMode()` — a developer running `npm run ui:dev` no longer sees a noisy hint pointing at the npm registry. Production builds (i.e. every published CLI release) are unaffected; `isDevMode()` is always `false` in the bundle that ships to users.

## User-facing

The topbar now shows the full project path under the **skill-map** wordmark, so a screenshot or a quick glance at the UI is always self-identifying. Previously only the last folder segment was shown, and projects scanned from their own root saw no path at all.
