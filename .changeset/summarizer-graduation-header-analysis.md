---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

`core/ai-summarizer-action` graduates from experimental back to stable / enabled by default now that its UI surface landed: a new `GET /api/nodes/:pathB64/summary` route (spec route-table row, direct shape) serves the node's stored summaries with per-row staleness, and the inspector header gains a sparkles button that queues the summarizer and expands the analysis (subject, key facts, quality notes, confidence, stale mark, re-run) under the identity strip.

## User-facing

**Analyze any file from its header.** A magic button next to the file's title runs an AI analysis; when it finishes (or the file already has one) the header shows what the file covers, key facts and quality notes. Outdated analyses are marked and can be re-run in one click.
