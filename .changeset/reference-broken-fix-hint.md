---
"@skill-map/cli": minor
---

Add a `fix.summary` remediation hint to the `core/reference-broken` error finding: fix the path or name, remove the broken link, or add the file's folder under "Folders for link validation" (the `scan.referencePaths` escape hatch, which clears path-style breaks only). Detection and `error` severity are unchanged.

## User-facing

**Broken-reference findings now suggest how to fix them.** Each one points at correcting the path or name, removing the link, or adding the file's folder under Folders for link validation in Settings, so links to files outside the project still validate.
