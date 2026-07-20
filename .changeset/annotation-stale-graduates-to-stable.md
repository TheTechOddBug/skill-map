---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The `core/annotation-stale` drift analyzer graduates from experimental to stable, so a default scan now surfaces sidecar (`.sm`) drift out of the box as an `info` issue; its read-only detection is safe on by default while the companion writer `core/node-bump` stays experimental (opt-in), decoupling the former bump pair. The `sidecar-end-to-end` conformance case now expects the extra issue, and the inspector drops the `never bumped` audit empty-state.

## User-facing

**Drift shows out of the box.** Scans now flag when a skill's `.sm` sidecar has fallen out of sync with its `.md`, no need to enable anything first. The inspector's Metadata section also drops the old `never bumped` line.
