---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Drop `requires`, `related`, and `conflictsWith` from the curated annotation catalog.

The three fields collapsed into the same edge kind (`references`), which made it impossible to tell from the graph whether an arrow meant "depends on", "is in conflict with", or "soft-related". The catalog now ships 10 fields instead of 13: versioning + supersession (`version`, `stability`, `supersedes`, `supersededBy`), provenance (`authors`, `license`, `source`, `sourceVersion`), taxonomy (`tags`), and docs (`docsUrl`).

The extractor `core/annotations` now declares `emitsLinkKinds: ['supersedes']` (no longer emits `references` from the sidecar). Path-style `references` edges still surface from `core/markdown-link` over `[text](path)` syntax in the body.

The schema keeps `additionalProperties: true`, so sidecars that still carry `requires` / `related` / `conflictsWith` continue to parse without errors, but those keys produce no edges and the built-in `unknown-field` analyzer surfaces them as warnings.

## User-facing

The `.sm` annotation catalog shrinks from 13 to 10 fields. `requires`, `related`, and `conflictsWith` were dropped, their edges all rendered as plain `references` and added no extra meaning. Existing sidecars keep working; the three keys are now flagged by `unknown-field`.
