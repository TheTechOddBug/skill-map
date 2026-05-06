---
"@skill-map/cli": patch
---

Fix Step 9.6 migration gap in the `frontmatter` extractor. The extractor was emitting structured links (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) by reading the legacy `metadata:` block in markdown frontmatter; Step 9.6.2 hard-cut the column denormalisation (`stability` / `version` / `author`) but never migrated this link-emission path. Result: any node whose annotations migrated to the new `.sm` sidecar lost its structured links from the graph (visible as a sudden link gap in the UI after the fixture migration).

Now the extractor reads the sidecar `annotations:` block first (the canonical Step 9.6 home) and falls back to legacy `metadata:` for unmigrated nodes. Both sources contribute; edges are deduplicated by `(source, target, kind)` so a node that lives on both shapes during the transition does not produce duplicate links. Adds support for `annotations.conflictsWith` (new annotation field, emits as `references` to stay within the existing `emitsLinkKinds`).

The kitchen-sink reference fixture in `fixtures/local-scope/.claude/agents/` and `fixtures/demo-scope/.claude/agents/` plus the demo / local fixture migration (legacy `metadata:` → `.sm` sidecars) ride along with this changeset since they exercise the new extractor path end-to-end. The local-scope and demo-scope graphs now show 15 links each (versus 5 with only body-extracted at-directive / slash links).
