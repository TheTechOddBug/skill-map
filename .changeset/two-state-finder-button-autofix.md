---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The inspector's AI-actions launcher becomes two-state finder buttons plus an Automatic toggle: a finder with a matching fixer is ONE button that morphs Detect ⇄ Fix by the node's open findings (the fixers row is retired), and the toggle makes it one-click detect+fix. Backing it, a per-job `autoFix` flag frozen at submit (`--auto-fix`, POST body, or toggle) chains all matching fixers at record. `prob-extensions` reshapes to `{ finders, standalone }` with `fixerIds` + `hasOpenFindings`.

## User-facing

Each analysis button in the inspector now detects, then turns into its fix once something is found, so there is one button instead of two. Flip the Automatic toggle to make it detect and fix in a single click.
