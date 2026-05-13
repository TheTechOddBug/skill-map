---
"@skill-map/cli": patch
---

Apply 3 findings from the `cli-hacker` security audit of `src/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

MEDIUM:

- **M1** `yaml.load(raw)` calls in `src/kernel/sidecar/parse.ts` and `src/kernel/sidecar/store.ts` now pass `{ schema: yaml.JSON_SCHEMA }` to align with the frontmatter parser (`src/built-in-plugins/parsers/frontmatter-yaml/index.ts:66`) and harden against a future `js-yaml` default-schema loosening. Sidecar parsing already rejects non-plain-object roots, but pinning the schema removes the implicit reliance on upstream defaults.

LOW:

- **L3** `src/server/routes/sidecar.ts` `loadNode()` 404 message now wraps the body-supplied `nodePath` in `sanitizeForTerminal()` before interpolation. Previously, an attacker-controlled `nodePath` could embed ANSI escapes or control characters in the response envelope and, transitively, in the BFF's stderr-mirrored error log. Mirrors the existing pattern at `src/server/routes/contributions.ts:152-154`.
- **L4** `src/cli/commands/init.ts` bootstrap writes (`settings.json`, `settings.local.json`, `.skillmapignore`) migrated from plain `writeFile` to `writeFileAtomicExclusive` (`src/core/config/atomic-write.ts`). The previous flow had a TOCTOU window between the `pathExists` check and the write; a local attacker who pre-planted a symlink at the final path could redirect the write. The helper stages through a temp file opened with `O_EXCL | O_NOFOLLOW` plus a CSPRNG suffix, then renames atomically.

Validation: typecheck + lint + build + 1503/1503 tests pass; `cli-reference.md` already in sync (no CLI surface change).
