---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Add an optional positional `variant` argument to `sm tutorial`. Default (no argument) keeps the previous behaviour and materializes `<cwd>/sm-tutorial.md` (the basic walkthrough). Passing `master` materializes `<cwd>/sm-master.md` (the advanced walkthrough: plugin tour, plugin authoring, settings + view-slots) through the same channel. The value is validated against the closed set `{ tutorial, master }`; anything else exits with code 2 and an `invalidVariant` error pointing at the valid values. The build pipeline (`tsup.config.ts → onSuccess`) now copies both SKILL.md sources into `dist/cli/tutorial/`, and the runtime resolver caches each variant independently. CLI i18n strings under `tutorial.texts.ts` were parameterized with a `{{filename}}` placeholder so the success block points the tester at whichever file was materialised. Spec § `sm tutorial` was rewritten to document the new positional and exit-code rule.

## User-facing

**`sm tutorial master`** materializes the advanced tester walkthrough (`sm-master.md`) in your cwd. Trigger it from Claude Code with `ejecutá @sm-master.md`. Bare `sm tutorial` keeps its previous behaviour and writes `sm-tutorial.md`.
