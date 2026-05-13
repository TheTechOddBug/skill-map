---
"@skill-map/cli": minor
---

Apply 13 of 15 findings from the `cli-architect` review of `src/` (audit run 2026-05-13). Behaviour and architecture only; lint and security audits were out of scope.

HIGH (user-observable behaviour):

- **H1** `runWatchLoop` now honors `--no-color`. `IRunWatchOptions` gained `noColor: boolean`; `WatchCommand.run()` and `ScanCommand.runWatchAlias()` thread `this.noColor` through. Watcher advisories used to colour-emit even with `--no-color` set.
- **H2** `sm refresh`, `sm watch`, `sm jobs prune` now resolve the project DB through `resolveDbPath({ global, db, ...ctx })` instead of `defaultProjectDbPath(ctx)`. The verbs previously dropped inherited `--db` and `-g` / `--global` on the floor. Test seed in `src/test/job-prune.test.ts` aligned with the new resolver path.
- **H3** Removed a hexagonal-inversion: `StoragePort` no longer imports from the SQLite adapter. `IPersistedContribution` moved to `src/kernel/types/storage.ts`; the SQLite adapter re-exports for back-compat and `src/server/routes/nodes.ts` was updated.

MEDIUM (design hygiene):

- **M1** `sm export --format` documented as a closed catalog with the `mermaid` deferral cross-referencing `cli/commands/graph.ts` (the open-catalog counterpart).
- **M2** Added a code-comment block on `HelpCommand` / `RootHelpCommand` explaining why they extend `Command` directly instead of `SmCommand` (no inherited common flags, by design).
- **M3** `sm conformance run` per-case progress (OK / FAIL lines, scope headers, summaries) moved from stdout to `printer.info` (stderr, suppressible by `--quiet`). The grand total result stays on stdout per the verb contract. Test expectations updated in `src/test/conformance-cli.test.ts`.
- **M4** Pulled ~65 sites of `ansiFor({ isTTY: ..., noColorFlag: this.noColor })` boilerplate into a single `protected ansiFor(stream: 'stdout' | 'stderr'): IAnsi` on `SmCommand`. 32 command files migrated; 5 freestanding helpers in `watch.ts` / `config.ts` intentionally left as they cannot access `this`. Output byte-identical.
- **M5** Marked `Duplicate = 3` and `NonceMismatch = 4` exit codes with `// TODO Step 10:` so the next reader knows they are reserved, not orphaned.
- **M6** Extracted `buildVerbCatalog()` shared between `HelpCommand.execute()` and `RootHelpCommand`, removing duplicated catalog-normalisation.

LOW:

- **L1** Closed the one Node-global leak in `src/server/`: the BFF used to pass `process.stderr` to `runScanForCommand`. New `noopWritable()` helper at `src/server/util/noop-writable.ts`; kernel progress events fan out through the WS broadcaster, the stream parameter is now a sink.
- **L3** `sm scan --watch` combo error now names the exact offending flag. Replaced the single lumped message with four per-flag two-line templates (`watchVs<Flag>` + `*Hint` per `cli-output-style.md` §3.1b); new `#firstWatchConflict()` selects the offender.
- **L4** `sm export` markdown renderer pulled sanitisation to the boundary: `buildSanitizedRows()` returns `ISanitizedNode[]` / `ISanitizedLink[]` / `ISanitizedIssue[]`, so the renderer interpolates without per-field `sanitizeForTerminal()`. Output byte-identical.
- **L5** `sm version` no longer silently swallows DB-read errors. The catch block now logs at `debug` so `-vv version` surfaces the failure; human + JSON output still reports `dbSchema: '-'` per the existing contract.

Skipped (review noted as no-op): M7 (`SqliteStorageAdapter.init()` mkdir was a defensive note, not a finding) and L2 (job-verb stub flag types are intentional forward-compat shape until Step 10).

Also finishes a small pre-existing WIP in `ui/` that was blocking `ng build`: `<sm-node-card>` now takes a single `selection: ISelectionView` input (selected / highlighted / dimmed bundled) instead of three booleans, and the graph view's `selectionState` exposes a precomputed `selectionView()` Map. Cuts N × 3 function calls per CD pass on dense graphs.

## User-facing

**CLI flags fixed.** `sm refresh`, `sm watch`, `sm jobs prune` now honor `--db` / `-g`. `sm watch` and `sm scan --watch` honor `--no-color`. `sm scan --watch` names the conflicting flag on combo errors. `sm conformance run` progress moved to stderr; `--quiet` silences it.
