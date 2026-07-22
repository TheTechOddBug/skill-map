---
"@skill-map/cli": patch
---

The SPA's node corpus now also refreshes on WS `job.completed` frames (debounced 500ms), not only on `scan.completed`, so the aggregate severity chips folded from open findings at read time reach map cards as soon as an AI action records its result, without an F5.

## User-facing

**Card counters update on their own.** The warning and error chips on map cards now refresh automatically when an AI review finishes, so new findings show up right away, no page reload needed.
