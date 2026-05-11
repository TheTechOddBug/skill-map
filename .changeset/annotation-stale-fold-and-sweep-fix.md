---
"@skill-map/cli": minor
---

Fold `core/sidecar-drift` into `core/annotation-stale` and fix a per-tuple sweep bug that left stale view-contribution rows orphaned for nodes whose path contained slashes.

**Sidecar drift surface unified under `core/annotation-stale`**

The `core/sidecar-drift` extractor introduced in `0.21.0` is removed; its functionality moves into the existing `core/annotation-stale` analyzer so one extension owns the entire sidecar-staleness story. The dual surface is now:

- **Issues panel** (`warn` severity, one per stale node) — unchanged behaviour.
- **`graph.node.alert` corner badge** (`pi-sync`, severity `warn`, `count: 2` only on `stale-both`) — the surface that previously belonged to `core/sidecar-drift`.
- **`card.footer.right` chip** (`pi-clock`, `value: 1` for one drifted face / `value: 2` for both, severity `warn`) — replaces the hardcoded `isStale` clock badge that used to live directly in `node-card.html`.

One toggle (`sm plugins disable core/annotation-stale`) now turns off every drift surface at once. Tooltips drop the `{{path}}` placeholder because the badge already sits on the affected node — the path is redundant — and keep the `sm bump <path>` literal as the operator's one-call fix.

**Files**

- Removed: `src/built-in-plugins/extractors/sidecar-drift/{index.ts,sidecar-drift.test.ts}`, `src/built-in-plugins/i18n/sidecar-drift.texts.ts`. Registration reverted in `built-ins.ts`; the built-ins count assertions revert from 26 → 25 total and 7 → 6 extractors.
- `src/built-in-plugins/analyzers/annotation-stale/index.ts` — declares `viewContributions: { drift, staleIcon }`, emits both alongside the existing `Issue`.
- `src/built-in-plugins/i18n/annotation-stale.texts.ts` — adds `bodyTooltip` / `frontmatterTooltip` / `bothTooltip` (no `{{path}}` placeholder).
- `src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts` — six unit tests covering the dual emission.
- `ui/src/app/components/node-card/node-card.{html,ts}` — drops the hardcoded `isStale` block and its `isStale` / `sidecarStatus` / `sidecarTooltip` computeds; `effectiveIsStale` / `effectiveStaleTooltip` survive in `node-derived.ts` because the inspector still consumes them.

**Per-tuple sweep bug fix (`/` → `\0` separator)**

`replaceAllScanContributions` keyed `freshlyRunTuples` and `bufferKeys` with a `/` separator between `pluginId / extensionId / nodePath`. Paths with internal slashes (e.g. `.claude/agents/architect.md`) broke parsing — `lastIndexOf('/')` chopped at the wrong slash, the `(pluginId, extensionId, nodePath)` SELECT missed every existing row, and the per-tuple sweep silently no-op'd. The symptom in the wild: editing a `.sm` to force drift made the badges appear; reverting the edit (undo) did NOT clear them because the old rows survived the sweep.

Separator is now `\0` (NUL). NUL is prohibited in POSIX paths and rejected by the kebab-case regex on plugin / extension ids, so collisions are impossible by construction. Producers (`orchestrator.ts`, two call sites — analyzers and extractors) and the consumer (`contributions.ts`) emit / parse the same separator. The wire format is internal: `freshlyRunTuples` is built in the orchestrator and consumed inside the same `replaceAllScanContributions` call.

- `src/kernel/orchestrator.ts` — both `freshlyRunTuples.add(...)` sites switch to NUL.
- `src/kernel/adapters/sqlite/contributions.ts` — `bufferKeys` build + tuple parse switch to NUL; the `lastIndexOf('/')` / `pe.indexOf('/')` parser is replaced by a `split('\0')` with a 3-parts guard.
- `src/test/view-contributions.test.ts` — the existing sweep test is updated to the new format; a new regression `per-tuple sweep handles nodePaths with slashes` exercises `.claude/agents/architect.md` end-to-end.

## User-facing

Stale sidecar drift now surfaces on the graph card via a `pi-sync` corner badge and a `pi-clock` footer chip — both fed by `core/annotation-stale`. Reverting a forced drift clears the badges immediately instead of leaving them pegged on the node.
