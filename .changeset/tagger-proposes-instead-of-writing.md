---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The auto-tagger now PROPOSES tags instead of writing them. A record-time write could only honour a standing `.sm` grant (a record callback cannot prompt), so a project without it burned a model call and silently produced nothing. The tags now ride the completion event and open the ordinary tags editor pre-filled, where the operator saves them under the usual consent handshake. The prompt also receives the node's CURRENT tags, so it proposes what is missing rather than near-duplicates.

## User-facing

Auto-tag now suggests tags in the tag editor for you to keep or drop, instead of silently doing nothing when sidecar edits are not allowed, and it stops proposing near-duplicates of tags you already have.
