---
"@skill-map/cli": minor
---

`sm findings clear (-n <path> | --all)` wholesale-deletes stored findings (safety rows included), and dismiss became a read-time suppression lens: rows are kept and hidden (`--dismissed` / `?dismissed=1` reveal them, `dismissedExcluded` counts them), new `sm findings suppressions` / `undismiss` list and lift entries with instant reappearance, finder submits auto-undismiss the re-judged class, and reads resolve suppressions from the `scan_nodes.annotations_json` mirror with single-node self-heal.

## User-facing

**Dismissing an AI finding now hides it instead of deleting it.** `sm findings suppressions` lists your dismissals, `sm findings undismiss` brings one back instantly, re-running a finder un-hides its findings, and `sm findings clear` wipes a node's (or all) stored findings.
