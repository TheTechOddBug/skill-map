---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

`sm bump` and the BFF bump route (`POST /api/sidecar/bump`) now stamp `audit.lastBumpedBy` / `audit.createdBy` with the project's Git author name (`git config user.name`) when the node lives in a Git repository, falling back to the channel literal (`'cli'` / `'ui'`) otherwise. This supersedes Decision A5, which kept the invoker a literal.

## User-facing

Bumping a node now records **who** bumped it: the audit `by` fields show your Git author name (`git config user.name`) instead of `cli` / `ui`, when the project is a Git repo. It falls back to `cli` / `ui` outside a Git repo or when no `user.name` is configured.
