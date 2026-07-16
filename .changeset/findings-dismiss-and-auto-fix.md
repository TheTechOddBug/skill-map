---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Two findings additions (Decision #144). `sm findings dismiss <id>` silences a finding the operator judged acceptable by writing a durable `annotations.suppressions` entry to the node's `.sm` sidecar (keyed by extension + type); the finder's record path then drops matching findings so the judgment stays silenced across re-runs, unlike a row a re-scan erases. And the finder-to-fixer chain can run automatically via the opt-in `core/auto-fix` hook (ships disabled) on `job.completed`.

## User-facing

`sm findings dismiss <id>` permanently silences a finding you have decided is fine (it stays gone across re-scans, recorded in the file's `.sm` sidecar). Enable the new `core/auto-fix` plugin to have fixers run automatically after their finder.
