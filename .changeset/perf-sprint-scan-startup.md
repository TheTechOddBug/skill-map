---
'@skill-map/cli': patch
---

Node perf sprint: the tokenizer moved to `gpt-tokenizer` behind a lazy handle (identical counts; a literal `<|endoftext|>` in prose no longer aborts the scan), warm rescans skip the SQLite replace-all via a whole-result fingerprint in `scan_meta` (schema fingerprint changes, so the derived DB rebuilds once after upgrading), the walk overlaps file reads with an ordered 16-deep read-ahead, and startup defers the kysely/sqlite, watcher and conformance subgraphs and enables the V8 compile cache.

## User-facing

Everything got faster: `sm` starts in about half the time, scans are quicker, and rescans of an unchanged project skip most database work. A file containing the literal text `<|endoftext|>` no longer breaks the scan. The project database rebuilds itself once after updating.
