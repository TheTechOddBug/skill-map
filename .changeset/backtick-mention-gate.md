---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Backticked `@handle` mentions and `/command` / `$skill` invocations now become graph links: the new `claude/backtick-mention`, `core/backtick-slash`, and `codex/backtick-dollar` extractors match inside code spans and fences, gated post-walk so only tokens resolving to a real entity survive (npm scopes, decorators, shell tokens never link nor flag broken). Claude mentions also resolve to skills and markdown docs via priority-ordered matrices, and usage-example self-loops no longer warn.

## User-facing

Names in backticks or code fences now link on the map when they exist: `@my-agent`, `@my-skill`, `@some-doc`, `/my-command`, and `$my-skill` all connect. Unrelated code tokens (npm packages, shell paths) stay ignored, and a doc showing its own command no longer warns.
