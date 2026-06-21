---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Add a `comingSoon` flag to a Provider's `presentation` (spec + kernel). A coming-soon Provider ships in the registry (node chips still render) but is never selectable as the active lens: auto-detect skips its markers, the BFF drops it from `GET /api/active-provider`'s `selectable` set, and the UI greys it with a `(coming soon)` suffix. `openai`, `antigravity`, and `agent-skills` are marked coming-soon, so only `claude` is selectable today.

## User-facing

Only the Claude provider is selectable for now. Codex, Antigravity and Open Skills appear greyed out as "coming soon" in the provider lens, and projects auto-detect Claude without a lens prompt.
