---
'@skill-map/cli': minor
---

Thirteen contract violations fixed and gated: five verbs missing the `elapsedMs` their contract requires, and eight writing human receipts to stdout under `--json` (human mode is byte-identical). Separately, `process.exit()` fired with bytes still queued on stdout, so over a PIPE any payload above 64 KB was silently truncated mid-document; `sm scan --json | jq` and `sm help --format json | jq` were losing data while redirecting to a file hid it.

## User-facing

Piping a large `--json` output into another tool no longer truncates it at 64 KB. `sm scan --json | jq` used to cut off mid-document while writing the same output to a file worked fine.
