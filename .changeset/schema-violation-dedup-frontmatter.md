---
"@skill-map/cli": minor
---

`core/schema-violation` no longer re-warns a node whose frontmatter the kernel already flagged. Its universal base-field check (missing `name` / `description`) reads `accumulatedIssues` and stays silent when a `frontmatter-invalid`, `frontmatter-malformed`, or `frontmatter-parse-error` already covers the node, so a single bad frontmatter surfaces one warning instead of two. The check still fires when the kernel said nothing (dispatch never reached the per-kind validator).

## User-facing

A file with invalid frontmatter now shows one warning instead of two. The schema check stops repeating what the per-kind validator already reported, so the issue list and the per-node warning count read cleaner.
