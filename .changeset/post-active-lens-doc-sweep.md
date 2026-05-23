---
'@skill-map/cli': patch
---

Internal cleanup that rides with the post-active-lens documentation sweep.

- `src/plugins/core/extractors/external-url-counter/index.ts`: drop the local copies of `computeLineStarts` / `lineFor` and import them from the shared `src/kernel/util/line-tracking.ts` (already used by `core/markdown-link` since the observable-link-analysis landing). Pure dedupe, no behaviour change.
- `src/plugins/claude/extractors/at-directive/index.ts`: JSDoc refresh pointing at the new `context/runtime-quirks.md` annex; clarifies that mid-prose `@file.md` is LLM-interpreted, not deterministically inlined by the runtime, with the line-start `@AGENTS.md` exception spelled out.
- `context/runtime-quirks.md` (new) + `AGENTS.md` topical-annexes table entry: capture the cross-runtime matrix (Claude / Codex / Antigravity / agent-skills / AGENTS.md standard) for `@mention` / `/cmd` / `[label](path)` / backtick literals, including Claude's documented `` !`cmd` `` exception and the upstream backtick-handling bugs we deliberately do not replicate.

No spec change, no public-surface change, no plugin manifest change.
