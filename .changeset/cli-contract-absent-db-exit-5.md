---
"@skill-map/spec": patch
---

Reconciled the exit-codes table in `cli-contract.md`: code `2` no longer claims a missing DB (it covers a present-but-unreadable or corrupt DB), and code `5` now documents an absent project DB file, so a read verb with nothing to open exits `5` (run `sm scan` first). This matches the reference CLI, which ~20 read verbs already honour, and the existing server boot-resilience clause; no behaviour changed.
