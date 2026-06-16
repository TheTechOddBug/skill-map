---
"@skill-map/spec": minor
"@skill-map/cli": minor
"@skill-map/web": patch
---

Remove the `supersede` feature end to end. The `supersedes` link kind is dropped from the global link-kind enum, the `annotations.supersedes` and `supersededBy` sidecar fields are removed from the spec, and the three built-ins that powered it (the `core/annotations` extractor, the `core/node-supersede` action, the `core/node-superseded` analyzer) are deleted. Scans no longer produce supersede links, and the inspector drops the Supersede button and the superseded-by banner.

## User-facing

The Supersede inspector button, the "superseded by" banner, and supersede links on the map are gone. The `supersedes` and `supersededBy` keys in `.sm` sidecars are no longer recognized, remove them from any sidecar that still declares them.
