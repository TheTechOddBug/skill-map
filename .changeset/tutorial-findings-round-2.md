---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Three findings from a second `sm-tutorial` external-tester session (Adolfo, 2026-05-25).

**Finding 1, `sm check --analyzers` silently accepts unknown ids** (`src/cli/commands/check.ts`)

`parseAnalyzersFlag` trimmed tokens and dropped empties, then `matchesAnalyzerFilter` compared them against the persisted `analyzerId` set. A typo like `broken-ref` (the real id is `core/reference-broken`, short form `reference-broken`) matched nothing, the verb returned `✓ No issues.` in green with exit 0, identical to a clean run; the planted broken-reference warning was invisible. The tutorial copy itself used `broken-ref` in the example commands, so following the walkthrough verbatim hid the fixture.

Fix: load the live Analyzer catalog when `--analyzers` is set, validate every token against both qualified (`core/reference-broken`) and short (`reference-broken`) forms, and on the first unknown id exit `ExitCode.Error` (2) with a stderr message naming the unknown id(s) and listing every valid qualified id. The catalog load is shared with the existing `--include-prob` path so the verb still pays for the runtime exactly once when both flags are present. Tutorial `.claude/skills/sm-tutorial/SKILL.md` updated to use the real ids (`reference-broken`, `core/name-reserved`, `core/link-self-loop`, `core/reference-redundant`).

**Finding 2, trigger-style links from universal-provider bodies never resolved** (`src/kernel/orchestrator/lift-resolved-link-confidence.ts`, `spec/architecture.md`)

The extractor gate already keys on the **active provider lens** (§Universal extractors and per-provider extractors): `claude/slash-command` under the `claude` lens emits `/handle` links from every node, including `notes/todo.md` classified by `core/markdown`. But the post-walk confidence-lift transform keyed on the **source node's provider id** (`markdown`), which declares no `resolution` map; the lookup short-circuited, the link stayed at `confidence: 0.8`, and `link.resolvedTarget` never got populated. Effect: even after the prior denormalised-`linksInCount` fix (be116dd) read `resolvedTarget ?? target`, markdown-sourced trigger links still incremented `linksInCount` against the authored trigger string (`/demo-command`) instead of the resolved node, and `sm list` IN stayed at 0 for the resolved command / skill node. The UI drew the arrow correctly (it walks `scan_links` directly), so the inconsistency surfaced as "arrow lands but IN=0".

Fix: align resolver authority with extractor authority by keying the `resolution` lookup on `ctx.activeProvider` instead of `sourceNode.provider`. `IPostWalkTransformCtx` gains a new `activeProvider: string | null` field; `buildPostWalkTransformCtx` in the orchestrator threads the lens through from `RunScanOptions.activeProvider`. `spec/architecture.md` §Provider · resolution rules updated to match (the prior wording was internally inconsistent with §Universal extractors and per-provider extractors, which already established the lens-driven principle). Existing test that asserted the old behaviour inverted to assert the new contract; a regression test for the exact sm-tutorial fixture (`/demo-command` from `notes/todo.md` under `claude` lens) and a complementary unlensed-project case (`activeProvider === null` short-circuits the name path) added.

**Finding 3, `sm plugins doctor` summary count looked off-by-N against `sm plugins list`** (`src/cli/commands/plugins/doctor.ts`)

Doctor's `enabled` count adds bundle-granularity bundles (count once) + extension-granularity extensions (count per extension). With a fresh install that totals 4 + 27 = 31. `sm plugins list` lists every individual extension under each bundle, so its surface count is 33 (3 claude + 1 antigravity + 1 openai + 1 agent-skills + 27 core). The two numbers were correct but unexplained; the tester read the doctor header `31 enabled` and the list count `33` and assumed a bug.

Fix: extend the doctor summary line to spell out the math: `plugins doctor: 31 enabled (4 bundles + 27 extensions) · 0 issues · 0 warnings`. New `countEnabledByGranularity` helper walks the same shape as `countByStatus` but tracks bundles and extensions separately so the breakdown reflects the project's actual granularity mix.

**Drive-by: tutorial wrap-up safer cleanup** (`.claude/skills/sm-tutorial/SKILL.md`)

The wrap-up advised `cd ~ && rm -rf <cwd>` with a single "if the cwd was a dedicated dir" caveat. The tester ran the tutorial in their day-to-day work dir; the bulk command would have nuked unrelated files. Wrap-up now branches on whether the cwd looks dedicated and surfaces the explicit per-file list (same shape as the "start over" branch already uses) when it does not.

## User-facing

`sm check --analyzers <id>` now errors with the valid id list when mistyped, instead of silently saying "No issues." `/invoke` and `@mention` links from any markdown body now contribute to the target's `IN`. `sm plugins doctor` summary spells out its bundle + extension split.
