---
"@skill-map/cli": patch
---

Internal: regression tests for the BFF `/api/links?to=` resolved-target lookup and the `core/reserved-name` source-side issue through `runScan`.

The production code shipped in `d207cfa` (BFF resolved-target arm + analyzer source-side surface) was covered only by unit tests with hand-built contexts. Two new test cases pin the wiring end-to-end:

1. `src/__tests__/integration/server-endpoints.spec.ts`, three new `it()` blocks in the `/api/links` suite: the `resolved_target` arm matches a trigger-style link via `?to=<resolved path>`, the literal `target` arm matches the same row via `?to=<trigger>`, and an orphan path returns zero items (negative guard against cross-row leak).
2. `src/__tests__/integration/reserved-name-source-side.spec.ts` (new file): runs the full `runScan` pipeline on a fixture where `.claude/agents/operator.md` invokes `/help` and `.claude/commands/help.md` is planted on disk. Asserts the slash link's confidence drops to `RESERVED_TARGET_CONFIDENCE`, the reserved-name analyzer emits both target-side and source-side warns with the expected `data.surface` / `nodeIds` / `data.target` shape, and verifies the analyzer stays silent on a slash link that does NOT resolve to a reserved name (negative guard against over-fire on every broken slash trigger).
