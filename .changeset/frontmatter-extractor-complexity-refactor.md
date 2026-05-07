---
"@skill-map/cli": patch
---

Internal refactor of the frontmatter extractor in `src/built-in-plugins/extractors/frontmatter/index.ts`. No behavior change — same emission rules, same dedup, same comment about the inverse-direction `supersededBy` edge. The duplicated body that processed each annotations-shaped block (sidecar `annotations:` and legacy `metadata:` frontmatter) is extracted into a new `processBlock(block, sourcePath, emit)` helper at module scope, plus a small `EmitFn` type alias. `extract` now does only: build the `seen` dedup set + `emit` closure, then call `processBlock` once per source. Drops cyclomatic complexity from 15 to under the project's max of 8 so the file no longer needs a per-function ESLint disable. Lint, typecheck, and the extractor test suite (30/30) are green.
