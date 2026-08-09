---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

An incremental scan no longer re-attributes unchanged nodes to the active lens. The mtime fast path skips `classify`, so it now reuses the prior node's provider the same way it already reused its kind, instead of binding the node to whichever provider's pass reached it first; a prior provider that stopped participating falls through to a real reread plus classify. That mis-paired `(provider, kind)` was also what made a re-extracted node emit a spurious `frontmatter-invalid: no-schema`.

## User-facing

Re-scanning a project no longer relabels plain markdown files with the active tool's badge, and no longer invents a "frontmatter failed schema validation" warning on files that have no frontmatter at all.
