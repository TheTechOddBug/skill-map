---
"@skill-map/cli": patch
---

Consolidate link-target resolution onto the kernel's authoritative `link.resolvedTarget` (stamped by the post-walk lift). `core/link-counter` now tallies footer chips by that field and shares a single `isSelfLoop` helper with `core/link-self-loop`, and the graph view reads `resolvedTarget` instead of recomputing its own name index. The duplicate kernel and UI resolvers are gone, so footer chip counts, drawn graph edges, and the incoming panel can no longer disagree.
