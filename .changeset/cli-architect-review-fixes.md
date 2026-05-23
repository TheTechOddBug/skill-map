---
'@skill-map/cli': patch
---

cli-architect review pass on `src/`: mechanical hygiene fixes, no behavioural change.

- **Type-naming**: renamed exported `type` aliases from the `I*` prefix (reserved for `interface`) to the convention-correct `T*` prefix. Covers `TScanRunResult`, `TDbVersionCheckOutcome`, `TWithSqliteVersionCheck`, `TBootstrapActiveProviderOutcome`, `TWatcherBatchOutcome`, `TRemoveConfigValueOpts`, `TAssertionResult`, `TAssertion`, `TPluginStore`, `TSettingDeclaration`. All callsites updated; internal-only, no public surface.
- **`scan-runner.ts`**: introduced a local `TLensResolution` discriminator so the lens-resolution helper's `{ kind: 'ok' }` arm can no longer be conflated with the richer `TScanRunResult.ok` shape.
- **Stale docstring**: `routes/project-preferences.ts` header now reflects the actual AJV-via-`makeBodyValidator` body-parsing path (was still describing the pre-migration `req.json()` posture).
- **`--json` suppresses info banners**: `SmCommand` now derives `quietInfo` from `quiet || json`, matching the `Printer` docstring. Banners on stderr (info-level) are silenced under `--json` so consumers piping to `jq` see no surrounding chatter on either stream.
- **Em dashes** removed from `kernel/orchestrator/cache.ts` and `kernel/extensions/collect-view-contributions.ts` (project-wide rule, lint rule covered only `*.texts.ts` catalogs).
- **Sync → async I/O** in `cli/commands/{scan-compare,sidecar,hooks}.ts`, replacing `existsSync` / `readFileSync` / `unlinkSync` / `writeFileSync` hot paths with `node:fs/promises` equivalents. The bootstrap loop in `init.ts` stays sync (single-file scaffold, clearer intent).
- **`routes/sidecar.ts`** now maps a client-supplied path-escape attempt to `HTTPException(400)` instead of 500, matching how `nodes.ts` already maps `PathCodecError`.
- **`scan.ts:333`** pre-formats AJV validation errors with `JSON.stringify` before substituting into the catalog template, replacing the previous `[object Object]` interpolation.
- **`plugins/ids.ts`** (new) exports `CORE_PLUGIN_ID`, `CLAUDE_PLUGIN_ID`, `OPENAI_PLUGIN_ID`, `ANTIGRAVITY_PLUGIN_ID`, `AGENT_SKILLS_PLUGIN_ID`. All 32 built-in plugin manifests + the two core actions now route through the constants. Runtime strings unchanged.
- **`server/limits.ts`** (new) consolidates `DEFAULT_LIMIT`, `MAX_LIMIT`, `BFF_MAX_BULK_CONTRIBUTIONS`. Consumed from `routes/nodes.ts` and `routes/issues.ts`. The 1 MiB body-limit stays in `server/app.ts` as it's wired into global middleware at the composition root.
- **`IAppDeps` / `IRouteDeps` cross-reference docstrings** added on both sides so a future field addition has a visible reminder to update both.
- **`server/index.ts`**: lifted the inline `import(...).IProvider` to a top-level `import type`.
- **Env-override fragility comment** on `SmCommand.applyEnvOverrides`: the `this.flag ||= envSet(...)` pattern works today because every relevant flag defaults to `false`; comment flags the assumption for future booleans.

Test repair (carried in the same commit because it blocked CI):
- `ui/src/app/views/graph-view/__tests__/graph-view.spec.ts`: added `{ provide: SKILL_MAP_MODE, useValue: 'demo' }` to both TestBeds. `GraphView` pulls `WsEventStreamService` transitively via `InspectorView` / `LinkedNodesPanel`; the service's `inject(SKILL_MAP_MODE)` fires at instance construction and was the source of the `NG0201` unhandled error.
- `ui/src/test-setup.ts`: added a no-op `ResizeObserver` polyfill for JSDOM so Foblex Flow's `FResizeChannel` no longer surfaces `ReferenceError: ResizeObserver is not defined` from `ngAfterViewInit`.

## User-facing

`sm <verb> --json` now also suppresses info banners on stderr, keeping both streams clean for piping into `jq`.
