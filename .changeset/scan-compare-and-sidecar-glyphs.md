---
"@skill-map/cli": patch
---

Polish `sm scan compare-with` and `sm sidecar annotate / refresh / prune` human output.

`sm scan compare-with` opens with a glyph headline (`✓` clean / `~` drift) and a sectional breakdown per row (`nodes:`, `links:`, `issues:`) with mid-dot separators — replacing the previous one-line `Delta vs X: N nodes added, M removed, K changed; …` dense format. The diff section format (`## nodes`, `+ path (kind)`, `- path (kind)`, `~ path (reason changed)`) stays unchanged for diff-tool / markdown compatibility. The "(no differences)" line picks up a green `✓`.

`sm sidecar` verbs add green `✓` to every success line: `annotate created`, `refresh fresh`, `refresh updated`, `prune none`, `prune summary`. The dry-run summary uses yellow `⋯` plus a dim `(no changes made)` tag. Plural-correct file noun (`1 file` / `N files`) replaces the old `file(s)` form.

No flag surface change; `--json` paths unchanged.
