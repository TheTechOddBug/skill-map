---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Dual-base link resolution: a backticked prose path that misses file-relatively now retries against the scan root before being flagged broken (unless it carries an explicit `./` / `../` prefix), and markdown links support GitHub's root-relative form, `[x](/docs/foo.md)` resolves from the scan root instead of being skipped. Closes the false "Broken pointer" on root-relative mentions written from nested folders, the dominant convention in agent docs.

## User-facing

Fewer false "Broken pointer" errors: a path in backticks written from the project root (like docs usually do) now resolves even when the file mentioning it lives in a subfolder, and `[text](/path/from/root.md)` links now work like on GitHub.
