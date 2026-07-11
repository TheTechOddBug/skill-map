---
"@skill-map/spec": patch
---

Correct the job `contentHash` formula to include `node.path` and NUL-delimit its inputs. The rendered content embeds `node.path` via `<user-content id>`, so the previous formula (which omitted it) let two nodes with identical body and frontmatter share one content row while rendering different text, breaking the "same hash, same content" invariant. Also clarify that `--force` bypasses the duplicate pre-check but never the unique partial index, so it only re-runs terminal jobs.
