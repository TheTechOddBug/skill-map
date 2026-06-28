---
"@skill-map/cli": patch
---

The shared `@`-token grammar (`kernel/util/at-token.ts`) now recognises a multi-level relative prefix (`@../../x`), not just a single `./` / `../` level. So a file-shaped `@`-reference that climbs more than one directory (in a Claude, Codex, or Antigravity body) resolves to its target instead of being silently dropped.

## User-facing

`@`-file references that climb more than one folder (e.g. `@../../docs/guide.md`) now draw an arrow to the target file; before, only single-level `@../x` references were recognised.
