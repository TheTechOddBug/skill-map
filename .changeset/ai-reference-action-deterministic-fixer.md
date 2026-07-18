---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New built-in fixer `core/ai-reference-action` (stable, enabled by default), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only on nodes with such Issues.

## User-facing

New fix-it job for broken links: after a scan flags a broken reference, queue `core/ai-reference-action` and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).
