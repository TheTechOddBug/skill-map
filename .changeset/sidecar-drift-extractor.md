---
"@skill-map/cli": minor
---

Add `core/sidecar-drift` built-in extractor.

When a node's `.sm` sidecar drifts from the live body / frontmatter hashes (i.e. `node.sidecar.status !== 'fresh'`), the new extractor emits a `pi-sync` corner badge to the `graph.node.alert` slot so the operator sees stale sidecars at a glance on the graph view. Each emission carries a `warn` severity tag and a tooltip that names the affected face (body, frontmatter, or both) and points at `sm bump <path>` as the one-call fix.

Severity is uniform `warn` across the three stale states — `stale-body`, `stale-frontmatter`, `stale-both` — and the worst case (`stale-both`) is differentiated by an extra `count: 2` chip next to the icon. Fresh sidecars emit nothing.

The extractor is unlocked: operators who do not want drift alerts on the graph can disable it with `sm plugins disable core/sidecar-drift`. Disable purges its `scan_contributions` rows immediately (per the eager-purge contract from spec 0.21.0), so the icons disappear from the UI without waiting for a rescan.

**Implementation**:

- `src/built-in-plugins/extractors/sidecar-drift/index.ts` — new extractor, `pluginId: 'core'`, `scope: 'frontmatter'`, no link emissions.
- `src/built-in-plugins/i18n/sidecar-drift.texts.ts` — three tooltip strings (one per stale state).
- `src/built-in-plugins/built-ins.ts` — registers the new extractor alongside `tools-count`.

**Tests**:

- `src/built-in-plugins/extractors/sidecar-drift/sidecar-drift.test.ts` — covers the seven branches: missing overlay, absent overlay, fresh, null status, stale-body, stale-frontmatter, stale-both.
- `src/test/built-ins-modes.test.ts`, `src/test/plugin-runtime-branches.test.ts` — assertion counts bumped from 6 → 7 core extractors and 25 → 26 total built-ins.

## User-facing

**New built-in.** Nodes whose `.sm` sidecar is out of sync with the file content now show a small sync badge on the graph card. Run `sm bump <path>` to refresh.
