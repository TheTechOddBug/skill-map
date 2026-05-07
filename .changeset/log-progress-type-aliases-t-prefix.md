---
"@skill-map/cli": minor
---

Rename five public type aliases on the kernel surface to match the project's `T*` prefix convention for type aliases (categories 1-4 already documented in `context/kernel.md` + `src/kernel/types.ts`; category 5 was implicit and is now formalized).

- `LogLevel` → `TLogLevel`
- `LogMethodLevel` → `TLogMethodLevel`
- `ProgressListener` → `TProgressListener`
- `LogFormatter` → `TLogFormatter`
- `IProviderKindIcon` → `TProviderKindIcon`

The first four are exported from `kernel/index.ts` / `kernel/ports/*` and from the root barrel. The fifth is re-exported from `kernel/extensions/index.ts` and consumed by the BFF (`server/envelope.ts`). All five are TS-only `type` aliases (string-literal unions, function-type aliases, discriminated unions) — they do not appear as standalone entries in `spec/schemas/*.json` and are not part of the JSON contract on the wire.

Note on the `IProviderKind*` family: `IProviderKind` and `IProviderKindUi` keep the `I` prefix because they are declared as `interface` (Category 4 — internal interfaces). `IProviderKindIcon` is renamed because it is a `type` alias (Category 5), not an interface. The asymmetry is intentional and tracks the new five-bucket convention.

Why now: the project already uses `T*` for every other type alias on the public surface (`TActionWrite`, `TExecutionMode`, `TGranularity`, `THookFilter`, `THookTrigger`, `TNodeChangeReason`, `TPluginLoadStatus`, `TPluginStorage`, `TWatchEventKind`). The four flagged names were drifting against that convention. The kernel naming-bucket doc in `context/kernel.md` and `src/kernel/types.ts` previously listed only four buckets ("internal shapes" with `I*` for everything in TS-only land); a fifth bucket "internal type aliases" with `T*` is now documented explicitly so future authors don't re-create the drift.

Why it's a `minor` and not a `patch`: this is a breaking change for any downstream consumer importing these names from `@skill-map/cli` — but per `AGENTS.md` § Pre-1.0 rules, breaking changes ship as minor bumps while the package stays in `0.Y.Z`.

No runtime / behavioral change. The function names and constants that share the conceptual root (`parseLogLevel`, `isLogLevel`, `logLevelRank`, `LOG_LEVELS`, `IResolveLogLevelOptions`, `extractLogLevelFlag`, `resolveLogLevel`) keep their identifiers — they reference the conceptual "log level", not the type identifier.
