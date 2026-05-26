---
'@skill-map/cli': minor
---

Aggregate severity counter for cards, drive-by cleanups in the footer-right slot.

**What changed**

- **New analyzer `core/issue-counter`** (`src/plugins/core/analyzers/issue-counter/`): owns the per-card `errorCount` / `warnCount` chips on `card.footer.right`. Reads the live issue accumulator threaded through `ctx.accumulatedIssues` and emits one chip per severity per affected node, capped at 99.
- **Two-phase analyzer scheduling**: `IAnalyzer.phase` is a new optional field with values `'detect' | 'aggregate'` (default `'detect'`). The orchestrator (`src/kernel/orchestrator/analyzers.ts`) sorts the input by phase before iterating, so every `detect` analyzer finishes before any `aggregate` analyzer runs. Stable inside each phase; filesystem-sorted generators keep their alphabetical output.
- **Analyzer context extension**: `IAnalyzerContext.accumulatedIssues?: readonly Issue[]` is the live issue accumulator (orchestrator-seeded `frontmatter-parse-error` / `frontmatter-invalid` plus everything emitted by `detect`-phase analyzers). Treat as read-only. Absent on legacy callers.
- **Orchestrator seeding**: `runAnalyzers` now takes a `seedIssues` argument; the orchestrator wires `walked.frontmatterIssues` through it so the aggregator counts those too. The downstream explicit push was removed (it would double-count).
- **Drive-by analyzer cleanup**: `reference-broken`, `schema-violation`, and `annotation-field-unknown` no longer emit their own chip contribution. Their `ui` block is empty; the underlying `Issue` records still ship through the same pipeline and surface in `sm check`, the inspector, and `sm export`. The aggregate chip replaces the visual duplication those per-analyzer counters produced.
- **Scan summary output**: `sm scan` (and `watch`'s scan banner) breaks issues by severity instead of one flat total, `N errors · M warnings · K info`, each tier colored to its severity (red / yellow / dim) and tiers with zero count collapsed out. Counts are NODES affected per tier (matching the UI severity palette badges), not raw issue-record counts. The red ✕ glyph is dropped from the error path; the per-tier red `N errors` is signal enough.
- **Footer-right ordering**: priority values on `annotation-stale` (10), `node-stability` (20), and `issue-counter` (warn 30, error 40) give a deterministic left-to-right read on `card.footer.right`: drift → stability → warn → error.

**SPA**

- `<sm-severity-palette>` (`ui/src/app/components/severity-palette/`): new graph-view filter, third sibling in `.graph__filter-stack`. Two toggles (`error`, `warn`) with node-affected counts; AND semantics with the graph-only severity filter. URL-synced via `?severities=error,warn`.
- `<sm-link-kind-palette>` now hides per-kind toggles when the loaded scan has zero links of that kind (and the whole palette collapses when no link kind has > 0 links). A previously-active kind that drops to zero is auto-removed from the whitelist via an effect.
- `<sm-node-card>` footer: the hand-rolled `errorCount` / `warnCount` chip block is gone. The footer renders contributions exclusively through `<sm-view-contributions-host slot="card.footer.right">`, and `issues` / `errorCount` / `warnCount` / `visibleIssues` are removed from the component. Issue details remain in the inspector view.
- `IssuePathsService` (`ui/src/services/issue-paths.ts`): new service that indexes `scan().issues` by severity for the palette and the filter chain. Threaded into `FilterStoreService.apply(nodes, severityCtx?)` so graph-view and list-view share the predicate.
- Perf-HUD: relabels `edges` to `links` to match the rest of the app.

**Tests + fixtures**

- Built-in analyzer count tests bumped from 16 → 17 (rules) and 33 → 34 (registry rows) for the new aggregator.
- `reference-broken`, `schema-violation`, and `annotation-field-unknown` spec suites rewritten: per-analyzer chip emission asserts removed, the `ui` block now asserts as empty, the underlying issue records still asserted.
- New `severity-palette.spec.ts`: visibility, count semantics, auto-clear effect, hover + active state.
- `local-scope` fixture: dropped the redundant `wip` tag from `experimental-agent.sm` and `experimental-skill/SKILL.sm` (already carry `stability: experimental`; the tag was leftover noise).

**Repo plumbing**

- `package.json` `bff:scan` wraps the scan in `(... || true)` so the prescript that primes the dev BFF's DB does not fail when the seeded fixture carries known error-severity findings.
- `AGENTS.md` adds a "No patch mindset" rule documenting the orientation toward clean root-cause fixes over local overrides, with the analyzer-chip refactor cited as the canonical example.

## User-facing

`sm scan` summary now splits findings per severity (`N errors · M warnings · K info`), colored and collapsed when zero. The graph view gains a third palette to filter cards with errors / warnings; the perf-HUD says "links" instead of "edges".
