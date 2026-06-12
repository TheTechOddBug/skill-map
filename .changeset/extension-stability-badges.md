---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Extensions can declare an optional `stability` lifecycle label (`experimental`, `beta`, `stable`, `deprecated`) in their manifest. Presentation-only: non-default values render as a badge in `sm plugins list` / `sm plugins show` and the Settings plugins panel; missing means `stable` and the kernel never gates behaviour on it. Declared in the spec's extension base schema and threaded through the loader, the BFF, and the SPA. `core/mcp-tools` is the first built-in flagged `experimental`.

## User-facing

**Plugin maturity at a glance.** Extensions can now carry an experimental, beta, or deprecated badge next to their name in the Settings plugins panel and in `sm plugins list`, so you can tell which parts of a plugin are still settling before relying on them.
