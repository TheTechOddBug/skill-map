---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New built-in fixer `core/ai-reference-action` (experimental), the first fixer for a DETERMINISTIC analyzer: it repairs broken reference links that `core/reference-broken` flagged by injecting that analyzer's Issues (`scan_issues`) into a `## Issues to resolve` job section keyed on the broken target. The agent repoints each link at its real in-project target, asking permission before searching outside the project; the inspector button shows only when the node has reference-broken Issues.

## User-facing

New optional fix-it job for broken links: after a scan flags a broken reference, enable `core/ai-reference-action` and queue it, and the agent repoints the link to where the file actually lives in your project (asking first before it looks outside the project).
