---
'@skill-map/cli': minor
---

Internal: rename the registry's base extension shape from `Extension` to `IExtension` so the kernel's type naming convention is uniformly applied. `Extension` was an unprefixed Category 4 internal interface (the registry's storage view, distinct from the Category 3 `IExtensionBase` author contract), the only one of its kind outside the closed grandfathered list (`RunScanOptions`, `RenameOp`, `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`) documented in `context/kernel.md` §Type naming. Renaming to `IExtension` brings it in line with `IPluginRuntimeBundle`, `IPruneResult`, `IDbLocationOptions`, and the rest of the bucket.

The rename is mechanical: `Extension` and its re-export from `src/kernel/index.ts` become `IExtension`; all six in-repo importers (`src/plugins/built-ins.ts`, `src/core/runtime/plugin-runtime/{catalogs,index,composer}.ts`) and the `kernel/orchestrator/index.ts` docstring are updated in the same diff. `ExtensionKind`, `qualifiedExtensionId`, and `DuplicateExtensionError` keep their names (separate concerns, not part of this convention sweep).

Pre-1.0 minor per `spec/versioning.md`: breaking rename of an exported kernel type. No behavioural change, no spec change, no schema change.
