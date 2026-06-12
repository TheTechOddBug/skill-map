---
"@skill-map/cli": patch
---

Reworks every built-in analyzer message into a compact finding grammar: the involved artifact (target, trigger, sidecar) leads on its own line, followed by a short label, count, detail, and a `(line N)` location suffix wherever the link records one (broken references, self-loops, reserved-name downgrades); duplicate occurrences group by trigger, and messages about the node itself drop the redundant path. The inspector renders the line break and `sm check` flattens it to one row.

## User-facing

Findings are shorter and clearer: the file or trigger involved leads on its own line, duplicates collapse to `Duplicate reference (2): \`refs/x.md\` (124, 145)`, broken references name the line they sit on, and messages no longer repeat the node's own path.
