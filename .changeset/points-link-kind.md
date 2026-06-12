---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Adds the `points` link kind to the closed enum: `core/backtick-path` now emits `points` instead of `references`, so a backtick path and a markdown link to the same target persist as two coexisting edges instead of merging, and `core/link-conflict` treats `points` as compatible with every other kind (no false conflict warns). `core/reference-broken` labels the kind "pointer".

## User-facing

Backtick paths get their own "Points" connector kind: a new palette toggle with a backtick glyph, its own edge colour per theme, and arrows separate from markdown-link references on the map.
