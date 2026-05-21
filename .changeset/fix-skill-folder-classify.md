---
'@skill-map/cli': patch
---

Three fixes to provider classification and Claude extractor heuristics, surfaced by the new provider end-to-end test plan.

**1. Strict `SKILL.md` matching in skill-folder providers.** Provider `classify()` for the `skill` kind now matches strictly `<vendor>/skills/<name>/SKILL.md` (one folder level, filename `SKILL.md` case-insensitive). Supporting files inside a skill folder (`README.md`, `helpers.md`, `references/foo.md`, nested `sub/SKILL.md`, etc.) were being reclassified as `skill` by the `claude`, `gemini`, and `agent-skills` providers, contradicting Anthropic's documented convention (one `SKILL.md` per skill folder) and the providers' own inline comments. Such files now correctly fall through to `core/markdown`.

**2. Case-insensitive dedup in `claude/at-directive`.** Bodies that mixed `@foo.md` with `@FOO.MD` were emitting two distinct `references` links and tripping `trigger-collision` as a side-effect. The dedup set now keys on the lowercase target so the two forms collapse into a single link (preserving the first-seen casing in `target`); `normalizedTrigger` was already lowercase, this aligns dedup with it.

**3. `?q=/foo` no longer matches as a slash command.** The `claude/slash` extractor's lookbehind excluded `?` and `#` but not `=` / `&`, so query-string values like `?q=/algo` were matching `/algo` as an `invokes` link. Lookbehind extended to `[A-Za-z0-9_/.:?#=&]` so URL query separators no longer leak slash directives.

## User-facing

Skill folders no longer count auxiliary `.md` files (README, helpers, nested files) as extra skills, only `<name>/SKILL.md` is a skill. Mixed-case `@foo.md` and `@FOO.MD` now dedup to one link. URL query strings like `?q=/foo` no longer produce phantom `/foo` invocations.
