---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Wire the Signal IR resolver end-to-end (Phase 2.A of the active-lens migration). The kernel's `resolveSignals` runs after extraction and before analysis: filters disabled extractors (Phase 4+ stub), ranks intra-Signal candidates via `IProvider.resolverRules.kindPriority` (when declared) + confidence + extractor declaration order, builds overlap clusters from body-scoped Signals sharing a source, picks a cluster winner per the four-step tiebreak chain (`kind-priority` -> `higher-confidence` -> `longer-range` -> `earlier-declaration`), materialises winners as Links indistinguishable from `emitLink`-emitted ones, and annotates each Signal's new `resolution` field with the outcome + reason. Rejected (losing) Signals remain accessible to analyzers via `IAnalyzerContext.signals` so a future `core/signal-collision` analyzer can surface them as `warn` issues naming WHO won and WHY.

Spec changes: `signal.schema.json` gains the `resolution` object property (outcome / winnerIndex / rejectedBy / phase 4+ stubs); `extensions/provider.schema.json` gains `resolverRules.kindPriority`; `architecture.md` §Resolver phase rewritten to reflect the wired contract; `conformance/coverage.md` row 37 flipped to in-progress.

Kernel changes: extend `Signal` type with `resolution?: ISignalResolution`; add `IResolverRules` + `IProvider.resolverRules`; rewrite `resolveSignals` (87-line first-candidate scaffold -> full algorithm); thread `signals` through `walkAndExtract` accumulators -> `runAnalyzers` -> per-analyzer context; export `isExternalUrlLink` for the caller's routing of materialised Links between internal / external arrays.

No extractor uses `emitSignal` yet (Phases 2.B and 2.C migrate them). With zero Signals emitted today the wiring is a no-op pass-through that returns empty arrays; 18 new resolver unit tests cover intra-Signal ranking, cross-Signal overlap, the four tiebreak reasons, kindPriority interaction, external-URL cluster skip, frontmatter / sidecar scope pass-through, and materialised Link shape parity.
