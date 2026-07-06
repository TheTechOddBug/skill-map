---
"@skill-map/cli": minor
---

New built-in analyzer `core/name-mismatch` flags nodes whose declared `frontmatter.name` diverges from their filename/dirname handle: warn for open-standard skills (the spec requires name == dirname), info where the vendor documents the override as legal. `core/name-collision` gains a warn tier for a declared name colliding with another node's file-derived handle; declared-vs-declared stays error and plain markdown stays out of the collision index.

## User-facing

Scans now flag naming drift: a skill whose folder name differs from its name field gets a warning, and an agent or command whose name shadows another file's name is flagged too, so references stop pointing at the wrong file silently.
