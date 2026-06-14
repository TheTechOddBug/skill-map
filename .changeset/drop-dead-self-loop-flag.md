---
"@skill-map/cli": patch
---

Remove the dead `data.selfLoop: true` flag from `core/link-self-loop` issues. No consumer ever read it: the graph view recomputes the `source === resolvedTarget` predicate independently in its render-pipeline mirror, so the flag (and its "authoritative detector" doc claim) was vestigial. The doc comment now states the rule reports and the layout draws as deliberately independent paths, and the two obsolete `data.selfLoop` test assertions are dropped.
