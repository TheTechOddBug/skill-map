---
"@skill-map/cli": minor
---

Every mutating operation now appends a one-line JSONL record to `.skill-map/operations.log` via the new single writer in `src/core/operations-log.ts`, wired across `sm scan`, watcher persists, and the job and finding lifecycles on both CLI verbs and BFF routes. A new `GET /api/config/resolution` endpoint flattens the effective config to per-key rows with layer provenance (secrets masked), rendered by the new Settings resolution dialog in Settings > General.

## User-facing

**Operations log and settings resolution.** Every scan, job and finding operation now leaves a line in `.skill-map/operations.log`, and Settings > General gained a "Settings resolution" viewer showing each setting's effective value and which config file set it.
