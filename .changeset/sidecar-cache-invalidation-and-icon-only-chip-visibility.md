---
"@skill-map/cli": minor
---

Fix two bugs around sidecar-driven UI updates and adopt Font Awesome Free in the bundled UI as a webfont addition (no spec changes, no plugin-author surface yet).

**Watcher invalidates extractor cache on `.sm` sidecar edits (`src/core/watcher/runtime.ts`)**

The kernel's per-extractor cache (`scan_extractor_runs`) is keyed by `bodyHash` + `frontmatterHash` of the `.md` file. Extractors that read `node.sidecar.annotations` (today: `core/stability`, `core/annotations`, `core/annotation-stale`) would silently re-use the previous contribution on a sidecar-only edit — the chip never refreshed in the UI until the underlying `.md` was touched. Fix: the primary watcher's `onBatch` now inspects `batch.paths`; if any path ends in `.sm`, it forwards `invalidateCache: true` to `runOnePass`, which sets `enableCache: false` and omits `priorExtractorRuns`. End-to-end verified: editing a sidecar's `stability:` value re-renders the corresponding card chip in ~5–6 s. This is a localized workaround; the structural fix (extending `scan_extractor_runs` with `sidecar_hash_at_run`, or surfacing an `IExtractor.readsSidecar?: boolean` declarative flag) is tracked separately.

**Icon-only counter chips are now visible (`ui/src/app/renderers/node-counter/node-counter.ts`)**

`NodeCounter` renders `card.footer.right` chips with `value: 0` as icon-only (the pattern adopted by `core/stability` experimental / deprecated and `core/annotation-stale`). The icon's `font-size: 0.6rem` is sized to sit next to a number — standalone, the glyph rendered as a sub-6×6 px dot, effectively invisible. Added a `vc-counter--icon-only` modifier (active when `value() === 0`) that bumps the standalone icon to `0.8rem` (~7.7×7.6 px of glyph). Numbered chips (warn / error counts, outgoing-ref counters) stay at `0.6rem` because the digit is the visual anchor.

**Font Awesome Free 7.2.0 wired into the UI bundle (additive, webfont mode)**

- `ui/package.json`: `@fortawesome/fontawesome-free` pinned at `7.2.0` (no caret).
- `ui/angular.json`: `all.min.css` inserted between `primeicons.css` and `src/styles.css` in both `production` and `analyze` configurations so PrimeIcons keeps its existing `pi pi-*` classes and FA layers `fa-solid fa-*` on top. Initial budget warning raised `600 kB → 700 kB` to absorb the ~48 kB raw / ~6 kB gzip CSS delta; `maximumError: 750 kB` left untouched. Build is warning-free.
- `ui/src/app/app.html`: one smoke-test migration — the Settings button moved from `icon="pi pi-cog"` to `icon="fa-solid fa-gear"`. This proves the webfont loads and is wired into PrimeNG's `<p-button [icon]>` slot. No other migrations in this change.

No spec changes (the `IconString` grammar and `Provider.ui.icon` field are untouched — plugin authors still emit PrimeIcons / emoji only). FA is currently a private affordance for app chrome; broadening it to plugin manifests is a separate spec decision.

## User-facing

Sidecar (`.sm`) edits now propagate to the UI in real time — change a `stability:` value and the card chip refreshes on the next watcher tick. Icon-only chips (experimental / deprecated / stale-sidecar) on the card footer are now legible (they were rendering as sub-pixel dots).
