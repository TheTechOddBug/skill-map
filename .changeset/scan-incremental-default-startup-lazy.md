---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

`sm scan` is now incremental by default: with a persisted prior snapshot, unchanged nodes are reused and only changed files re-extract (`--full` forces a complete re-extraction; `--changed` stays as an explicit alias). Startup also sheds fixed costs on every verb: the server import is deferred to `sm serve`, spec validators compile on first use, the tokenizer is built once per process, the serve watcher reuses the boot plugin runtime, and the bundle code-splits.

## User-facing

Scans are now incremental by default: repeat scans reuse unchanged files and finish much faster (use --full for a complete rescan). Every sm command also starts noticeably faster.
