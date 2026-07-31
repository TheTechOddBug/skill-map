---
'@skill-map/spec': major
---

Plugin storage Mode B (dedicated tables) is removed. Its runtime accessor was always fiction (a scoped `Database` wrapper with a per-query validator and transactions, specified but never built), so a plugin could get tables created and then had no way to read or write them: a dead end with no users. `storage` is now the KV shape only. Mode A is untouched and is the mode with a working `ctx.store`.
