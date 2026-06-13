---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Broken graph edges now render fainter than resolved ones. `core/markdown-link` emits the spec's `0.95` (unambiguous syntax) instead of a hardcoded `1.0`, and the post-walk confidence-lift transform adds a `BROKEN_TARGET_CONFIDENCE = 0.5` downgrade for links that resolve to nothing (no path and no name-index match, like `core/reference-broken`). A dangling `[x](missing.md)`, `@missing.md`, or `/no-such-command` now sits at `0.5`, below a resolved `1.0` and above a reserved `0.1`.

## User-facing

Broken links in the graph now appear fainter than working ones: a markdown link, `@file`, or `/command` pointing at something that does not exist renders at low opacity, so dangling references stand out at a glance instead of looking like solid edges.
