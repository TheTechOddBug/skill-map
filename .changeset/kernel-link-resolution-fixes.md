---
"@skill-map/cli": minor
---

Fix two kernel bugs surfaced in a manual link-matrix test session, both affecting how invocation/mention edges land in a real scan.

1. **Post-walk transforms ran with empty provider indexes.** `buildPostWalkTransformCtx` built its provider kind / resolution / reserved-name maps from `kernel.registry.all('provider')`, but the registry only stores `toExtensionRow()`-stripped manifests (`{ id, pluginId, kind, version, description }`); the `kinds`, `resolution`, and `reservedNames` fields are all `undefined` there. Net effect during a real scan: `liftResolvedLinkConfidence` could not lift a single resolved link to `1.0` (mentions stayed at the at-directive emit floor `0.5`, invokes at the slash emit floor `0.8`), and the `core/reserved-name` analyzer never emitted issues. The fix threads the full `exts.providers` list (already flowing through `runScanInternal`) into `buildPostWalkTransformCtx` and `buildProviderIndexes` directly, so post-walk reads the unstripped manifests. The pre-existing unit test for `liftResolvedLinkConfidence` could not catch the regression because it builds the ctx by hand, so a new integration test in `src/__tests__/integration/scan-e2e.spec.ts` asserts the wiring on a real scan flow (resolved `/deploy` lifts to `1.0`, broken `/unknown` stays at `0.8`, broken `@backend-lead` stays at `0.5`).

2. **`core/markdown-link` extractor matched links inside code regions.** The extractor ran `LINK_RE` straight over `ctx.body`, while sibling extractors (`at-directive`, `slash`) already strip code via `stripCodeBlocks` because fenced blocks and inline code spans are author-marked literal payload, not link surface. Any README documenting markdown link syntax inside backticks (` `[md](./foo.md)` `) or fenced blocks (` ```md ... ``` `) was emitting spurious `references` edges, which in turn fed `core/broken-ref` false positives. The fix imports `stripCodeBlocks` and runs `ctx.body` through it once at the top of `extract()`; `stripCodeBlocks` replaces code regions with same-length whitespace so `location.line` stays accurate. Three new test cases in `src/plugins/core/extractors/__tests__/extractors.spec.ts` cover inline-code, fenced, and mixed (one in-code link skipped, one prose link still emitted) scenarios.

Both fixes touch kernel-internal wiring (`src/kernel/orchestrator/index.ts`, `src/plugins/core/extractors/markdown-link/index.ts`); no public API or CLI surface changed. Pre-1.0 minor per `spec/versioning.md`.

## User-facing

**Two scan-time bugs fixed.** Resolved `/slash` and `@mention` links now correctly land at confidence `1.0` (were stuck at the emit floor), and the markdown-link extractor no longer flags `[label](path)` shown inside backticks or fenced code blocks as broken references.
