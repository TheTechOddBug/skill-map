---
"@skill-map/cli": minor
---

Add the queue inspector: a `GET /api/jobs` BFF endpoint (registry-less `jobs` envelope, the record nonce stripped from every row) and a new workspace-rail Queue tab listing the whole job queue live, with a status glyph, node-first columns, node/extension search, status filter chips carrying live counts, optimistic per-row cancel, pagination, and bidirectional node selection through the shared path bus. The rail is now an activity bar plus a tabbed Files / Queue panel.

## User-facing

**See and manage the whole job queue.** A new Queue tab lists every job with its status, lets you search and filter them, cancel jobs inline, and page through the list. Selecting a job highlights its node on the map, and vice versa.
