---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Rename `core/field-unknown` to `core/annotation-field-unknown` so it
groups alphabetically with the other sidecar (`.sm`) annotation rules
(`core/annotation-orphan`, `core/annotation-stale`). The rule's job has
not changed: it still flags typos / unrecognised keys in sidecars and
emits a warn issue plus the same `alert` + `chip` view contributions
on `graph.node.alert` / `card.footer.right`.

`contribution-orphan` is intentionally NOT renamed: the `contribution`
namespace refers to view-slot rows in `scan_contributions` (runtime
data the analyzers emit for the UI), not to annotation fields in
sidecars. The two namespaces are distinct.

Pre-1.0 minor per `spec/versioning.md`: breaking rename of a public
qualified id referenced from `settings.json`, `--analyzers <id>` flags,
and the `analyzerId` filter on `GET /api/issues`. No behavioural
change, no DB schema change, no event payload shape change. Persisted
scans created with the old id regenerate cleanly on the next
`sm scan`.

## User-facing

Renamed `core/field-unknown` to `core/annotation-field-unknown` so the
sidecar typo-guard rule groups with the other `core/annotation-*`
rules. Update references in `settings.json` or
`sm check --analyzers <id>` to the new name.
