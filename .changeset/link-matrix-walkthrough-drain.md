---
"@skill-map/cli": minor
---

Drain pass after the link-matrix walkthrough surfaced rough edges across the CLI surface and the inspector. No new normative spec, only impl polish and tightened error semantics.

**CLI error blocks adopt `context/cli-output-style.md` §3.1b.** A `✕` glyph + a dim hint replace the previous mix of single-line `error:` lines and double-glyph wrappers across init, scan, config, help, history, export, and the bare-`sm` no-project entry point. Catalogue entries grow `{{glyph}}` placeholders so colour resolution stays at the CLI seam (the kernel runtime keeps its boundary discipline, no `process.env` reads in `core/runtime/`). `context/cli-output-style.md` gains a §99 compliance checklist that new verbs are expected to gate against.

**`sm config set activeProvider` validates the id before touching state.** The set used to accept any string, then run the destructive `dropScanZone` to clear the `scan_*` tables, leaving the operator with a broken setup on a typo. The new code cross-checks against `builtIns().providers.map(p => p.id)` at set-time, emits a §3.1b error with the allowed-id list, and exits 2 BEFORE any write or table drop. Two new catalogue entries (`activeProviderUnknown` / `activeProviderUnknownHint`).

**`sm init` prompts during the first scan when multiple providers are detected.** Previously init's first scan passed `yes: true`, skipped the lens prompt, and left `activeProvider` unset, the next real `sm scan` then re-detected and prompted again. The new flow threads `stdin` through `runFirstScan` and the prompt happens once, during `init`. For CI / non-TTY, `--no-scan` still bypasses both the scan and the prompt.

**Active-provider prompt + ambiguous-under-yes error block.** The runner catalogue grew `{{glyph}}` placeholders on `activeProviderPromptHeader` and `activeProviderAmbiguousUnderYes`, plus a sibling `activeProviderAmbiguousUnderYesHint` so the §3.1b two-line block renders correctly. `active-provider-bootstrap.ts` opts grew `style?: { warnGlyph?, errorGlyph?, dim? }`; init.ts and scan.ts thread pre-rendered colour from `ansiFor` at the boundary. The double-glyph regression (init / scan re-wrapping the runner's pre-formatted message in another `{glyph} sm <verb>: {message}` shell) is gone, both verbs print the runner block verbatim.

**Catalog audit pass 1, `history` / `help` / `export`.** Migrated to §3.1b: `history.invalidIsoDateTime` (the hint now ships a concrete `2026-05-23T14:30:00Z` example), `help.invalidFormat`, `help.unknownVerb`, `export.formatNotImplemented`, `export.formatUnsupported`. `export.errorPrefix` stays single-line §3.1 because the inner message varies per call site, but now carries a `{{glyph}}` placeholder. `export-cli.spec.ts` text assertions follow.

**UI inspector follow-ups.**

- `LinkedNodesPanel` switches the four-call fanout to `Promise.allSettled` so a non-load-bearing `getNode` failure (the external-refs decoration) leaves that slot empty without taking the panel down. `issueForOutgoing` / `issueForIncoming` now require the issue's `data.target` to name the link's `target`, `resolvedTarget`, or current path, the previous "any issue on the other endpoint" fallback bled unrelated `broken-ref` chips onto every row.
- Self-loops hidden from outgoing + incoming via an `isSelfLoop()` predicate. The `core/self-loop` analyzer (committed earlier) remains the authoritative detector; the panel just respects it.
- Kind dictates icon + colour, not provider. `NodeCard.providerAccent` always returns `null`; `KindIcon` no longer short-circuits on a per-provider `resolvedUi`. Provider identity surfaces via the subtitle chip, not via icon / colour overrides.
- Toggle palette gains an explicit-empty filter state. A new sticky `_kindToggleExplicitEmpty` signal distinguishes "default no-filter (all visible)" from "operator turned every toggle off (nothing visible)". The graph renders the empty canvas (instead of the `No nodes match` empty-state card) when the explicit-empty state is on. `toggleKind` accepts a `universe?` set so the palette passes its visible-kinds set (kinds with > 0 nodes) instead of the full registry, fixing the bug where turning off every visible toggle left an invisible registry-only kind selected.
- `LinkedNodesPanel` test setup + inspector body-refresh: mock stub returns proper resolved Promises for `getNode` / `listIssues`; the inspector body-refresh test counts only `opts.includeBody === true` calls so the panel's own (non-includeBody) `getNode` does not double the counter.

**Vitest localStorage shim.** New `ui/src/test-setup.ts` (wired via `ui/angular.json > architect.test.options.setupFiles`) installs a pure in-memory `Storage` polyfill. Node 24's experimental localStorage racing with jsdom was leaving 42 tests across `theme`, `graph-preferences`, `plugin-filter`, `expansion.controller`, and `demo-banner` failing with `Cannot read properties of undefined (reading 'clear')`. The full UI suite goes 467/467.

**Persistence round-trip tests.** New `src/kernel/adapters/sqlite/__tests__/round-trip.spec.ts` (6 cases) pins `Link.occurrences[]`, `Link.resolvedTarget`, and `Node.externalRefs[]` round-tripping through `nodeToRow` / `rowToNode` / `linkToRow` / `rowToLink`. Each case uses `mkdtempSync` per the kernel storage convention (`:memory:` does not work with the dual `DatabaseSync` open in `SqliteStorageAdapter`).

`resolveActiveLens` gains one `// eslint-disable-next-line complexity` to silence the cyclomatic-10 rule, mirroring the existing pattern on the rest of the runner (every branch gate-checks one outcome and splitting would scatter the gates from the values they gate). `.gitignore` adds `.skill-map/settings.local.json` + `.skill-map/skill-map.db` so a project-local DB / settings file living in the repo root does not get tracked.

Pre-1.0 minor per `spec/versioning.md`. No `spec/` files touched.

## User-facing

**CLI + inspector polish.** `sm init` now prompts for the active lens when markers compete; `sm config set activeProvider` rejects unknown ids upfront; error blocks across the CLI gain a `✕` glyph + hint; the inspector hides self-loops and paints kinds in their canonical colour.
