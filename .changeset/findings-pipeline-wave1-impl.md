---
'@skill-map/cli': minor
---

The findings pipeline lands: probabilistic Analyzers (finders) queue through `sm job submit` like Actions, `sm record` writes their judgments to the new `state_findings` table (plus kernel-derived safety rows from any probabilistic report), and the new `sm findings` verb reads them, stale-aware and advisory. Job rows now carry `extensionId` / `extensionKind`, the matching config keys and flags rename to extension terminology, and the `sm check` `--include-prob` / `--async` stubs are retired.

## User-facing

New `sm findings` command lists what LLM reviews recorded about your files, including prompt-injection warnings, and hides results for files you edited since. `sm job list --action` is now `--extension`, and `sm check` drops the never-functional `--include-prob`.
