---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

**Spec changes** (`@skill-map/spec`):

- `spec/schemas/extensions/hook.schema.json` — `triggers[].enum` grows from 8 to 10 entries (`boot` first, `shutdown` last). Top-level description updated to reflect the new size and the pipeline-driven vs CLI-process-driven split.
- `spec/architecture.md` § Hook · curated trigger set — table grows by two rows. `boot` documents the pre-verb dispatch (await semantics, fire-time, payload `{ argv }`); `shutdown` documents the post-verb dispatch (await semantics, payload `{ exitCode }`). The "Eight" wording flips to "ten" in the §Hook one-liner and the §Locality count of bundled built-ins (`one Provider, four extractors, five rules, one formatter, one hook` — the first built-in hook is `core/update-check`). The `## Stability and versioning` clause updates: trigger-set size goes from 8 to 10; adding an eleventh is a minor bump, removing or renaming any of the ten is a major bump.
- `spec/index.json` regenerated.

**Implementation changes** (`@skill-map/cli`):

- `src/kernel/extensions/hook.ts` — `THookTrigger` union and the frozen `HOOK_TRIGGERS` array grow from 8 to 10 entries (`boot` first, `shutdown` last so a debug log of the array reads in lifecycle order). Doc comment updated.
- `src/kernel/extensions/hook-dispatcher.ts` (new) — `IHookDispatcher`, `makeHookDispatcher`, and `makeEvent` extracted from `kernel/orchestrator.ts` so two callers can share the indexing / filter / error-handling semantics: the orchestrator for the eight pipeline-driven triggers (inside `runScan`), and `cli/entry.ts` for `boot` / `shutdown`. The orchestrator now imports the helpers; the duplicated inline definitions and `matchesFilter` / `buildHookContext` helpers are gone.
- `src/kernel/index.ts` — re-exports `makeHookDispatcher`, `makeEvent`, and `IHookDispatcher` so the CLI entry (and future drivers) can build their own dispatcher without crossing into orchestrator internals.
- `src/built-in-plugins/hooks/update-check/index.ts` (new) — first built-in concrete `IHook`. Subscribes to `boot`, deterministic mode. Imports `maybeRunUpdateCheck` from `cli/util/update-check-banner.js` and forwards the contracted `event.data: { dbPath, cwd, homedir, stderr, noColorFlag }` payload. Defensive: a `boot` event missing any contracted field is a no-op (rather than a throw), so a misconfigured driver degrades gracefully. The lint config does not restrict `built-in-plugins/**` from importing CLI helpers (built-ins are bundled in the same binary), so the cross-layer import is intentional — `cli/util/update-check-banner.ts` is the only legal home for the env / config reads (`SM_NO_UPDATE_CHECK`, `CI`, `loadConfig`, ANSI / TTY checks) per the kernel-boundary lint rules.
- `src/built-in-plugins/built-ins.ts` — imports `updateCheckHook` and pushes it into the `core` bundle (last entry). The `bucketBuiltIn` dispatch table already routed `kind: 'hook'` to `out.hooks`; no per-kind code change.
- `src/cli/entry.ts` — the inline `await maybeRunUpdateCheck(...)` post-`cli.run()` block is gone. Instead: the entry now imports `builtIns()` and `makeHookDispatcher`, builds a single dispatcher over `builtIns().hooks`, dispatches `boot` BEFORE `cli.process()` (so the banner lands above the verb's output, per the Phase 3 design call), and dispatches `shutdown` AFTER `cli.run()` and BEFORE `process.exit(exitCode)`. `boot` payload carries `{ argv, dbPath, cwd, homedir, stderr, noColorFlag }`; `shutdown` payload carries `{ exitCode }`. Both dispatches await; the dispatcher catches every hook error so a buggy hook can only delay the verb / exit, never alter the resolved exit code. User-plugin hooks subscribing to `boot` / `shutdown` are loaded but not yet dispatched on this path (built-in only) — documented as a follow-up in the README.
- `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions` "kernel-empty-boot" check no longer counts hooks. A hook subscribing only to `boot` / `shutdown` (the new CLI-driven triggers) reaches the composer through the built-in bundle but the orchestrator dispatcher would never invoke it; preserving the empty-boot shape regardless of hook presence keeps the conformance case honest while letting `core/update-check` ride along for the entry-side dispatcher to pick up.
- `src/built-in-plugins/README.md` — adds the `core/update-check` row and a paragraph on the two dispatch entry points (orchestrator vs CLI entry) sharing the same dispatcher module.
- `src/test/update-check-hook.test.ts` (new) — manifest-shape assertions and defensive-payload coverage for the hook (no-op when `dbPath` / `cwd` / `homedir` / `stderr` are absent; clean forward when contracted; DB missing → silent bail). Pre-existing unit + integration tests for `maybeRunUpdateCheck` (in `src/test/update-check.test.ts`) keep covering the cache + bail + banner behaviour end-to-end — the hook is a thin wrapper.
- Two pre-existing tests updated for the new built-in count: `src/test/built-ins-modes.test.ts` (`listBuiltIns().length`: 23 → 24, comment updated to call out the new hook).

**ROADMAP changes**:

- §Plugin system · Hook trigger set — list grows from 8 to 10 entries; new paragraph documents the dispatcher module split (`kernel/extensions/hook-dispatcher.ts`) and points at `core/update-check` as the first built-in consumer.
- §Glossary · Hook — one-liner updated from "one of eight" → "one of ten" with the pipeline vs CLI-process split.

**Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (two new triggers, one new built-in hook, one new internal kernel module). No existing surface is removed or renamed; old hooks subscribing only to the eight pre-existing triggers keep working byte-for-byte. Pre-1.0 lets us land additive contract growth as `minor` without flipping to 1.0.0.
