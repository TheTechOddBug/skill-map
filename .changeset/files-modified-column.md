---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The scan now captures each file's modification time (`mtime`) from the walker's existing `lstat`, persisted on `scan_nodes.modified_at_ms` and surfaced on the node wire shape as `modifiedAtMs` (nullable for virtual / derived nodes). The files table gains a sortable "Modified" column at the end, rendered as an ISO short date with a full date+time tooltip; sorting orders by the raw timestamp and sinks fileless nodes to the bottom. The value never participates in `bodyHash` / `frontmatterHash`.

## User-facing

The files table has a new **Modified** column showing when each file was last edited (for example `2026-06-13`). Click the header to sort newest or oldest first, and hover a cell to see the exact date and time.
