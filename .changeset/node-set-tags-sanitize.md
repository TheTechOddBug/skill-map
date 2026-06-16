---
"@skill-map/cli": patch
---

Sanitize the tags written by the `core/node-set-tags` action: it now keeps strings only, trims them, drops empty entries (the `annotations.tags` schema requires non-empty items), and dedups, instead of writing the free-form input verbatim. Prevents the Edit tags flow from producing a schema-violating or messy sidecar.

## User-facing

Editing a node's tags now drops blank and duplicate entries and trims whitespace, instead of saving them as-is.
