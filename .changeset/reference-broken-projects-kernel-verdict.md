---
"@skill-map/cli": patch
---

Make `core/reference-broken` a pure projector of the kernel's broken-link verdict. The post-walk lift now computes the genuinely-broken set (the kind-agnostic "the name exists nowhere" notion of `spec/architecture.md` §Provider · resolution rules) and threads it via `IAnalyzerContext.brokenLinks`. The rule projects that set instead of re-deriving a frontmatter-name-only index that false-flagged links resolving via a filename / dirname identifier; `core/name-reserved` reads `link.resolvedTarget`.

## User-facing

**Fewer false broken-reference errors.** A `@name` or `/name` that points at a same-named file no longer reports as broken, even when that file has no `name:` in its frontmatter; the reference resolves like the runtime follows it.
