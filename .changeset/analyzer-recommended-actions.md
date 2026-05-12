---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add `IAnalyzer.recommendedActions` so an Analyzer can declare which per-node Actions resolve its findings.

`spec/schemas/extensions/analyzer.schema.json` gains an optional `recommendedActions: string[]` (qualified action ids, `^[a-z0-9-]+/[a-z0-9-]+$`, unique). Distinct from the existing `IActionPrecondition` (Action-side filter: "I apply to nodes matching X"); `recommendedActions` is Analyzer-side ("when I fire, these per-node Actions are the canonical resolution"). The UI consumes both: the node inspector renders "Applicable Actions" from `IActionPrecondition` matching and "Recommended for issues" from `recommendedActions` of the Analyzer that fired each Issue.

Actions are per-node by design (matches the shape of `IActionPrecondition`). Project-level cleanup operations (e.g. `sm job prune --orphan-files`) stay as CLI verbs and are NOT surfaced through this field — therefore `core/contribution-orphan` and `core/job-orphan-file` analyzers do NOT declare `recommendedActions`. Built-in pairing shipping with this change: `core/annotation-stale.recommendedActions = ['core/bump']` — a stale sidecar is resolved by bumping the node (refreshes the `for` hashes and stamps the audit block).

Side-cleanup: the two earlier project-level action stubs `core/relink-contributions` and `core/prune-orphan-files` are removed; they were miscategorized as Actions. The per-node Action stub `core/mark-superseded` stays (declarer for `supersededBy`). The kernel `IAnalyzer` TS interface gains the matching optional `recommendedActions?: readonly string[]` field. Built-in extensions count returns to 26.

## User-facing

Node inspector will start showing two distinct lists of Actions: "Applicable" (always-available) and "Recommended" (per finding on the node). The first concrete pairing: when a node's sidecar is stale, the inspector recommends running `bump`. UI hookup itself is the next iteration; the spec field ships first.
