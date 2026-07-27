---
'@skill-map/cli': minor
---

Deterministic issues can now be dismissed per (analyzer, value): the new `sm issues dismiss / undismiss / suppressions` verbs, server routes, an inspector per-issue button, and MCP tools write a standing `annotations.issueSuppressions` entry in the node's `.sm` that `core/reference-broken` honours at emission time. Broken `@`-mentions whose token is code-shaped (`@ApiSecurity`, `@nestjs/swagger`) now emit `warn` instead of `error`, so they no longer fail `sm scan` / `sm check`.

## User-facing

Broken-reference false positives can now be dismissed: `sm issues dismiss` (or the dismiss button on an issue row) silences an exact flagged value. Code-looking tokens like `@ApiSecurity` or `@nestjs/swagger` now warn instead of error, so scans stop failing on them.
