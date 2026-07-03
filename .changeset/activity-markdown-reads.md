---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Live activity now lights markdown nodes: activity signals gain a path-based form (`{ path, phase, owner? }`, resolved by exact `node.path` match across providers), and the claude adapter maps `Read` tool events to path signals with a filter-first early disclaim (non-`.md` reads and paths outside the scope root never reach the node set). `sm activity install` switches to refresh semantics so re-running updates skill-map's own hook entries in place.

## User-facing

**Markdown files light up too.** When Claude Code reads any scanned `.md` (your notes, docs, a skill's file), its node now glows on the live map like skills and agents do. Re-run `sm activity install claude` once to pick up the new wiring.
