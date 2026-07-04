---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The live-activity hook is now manageable over HTTP: `spec/provider-activity.md` gains a normative install-management contract (status probe plus install/uninstall that MUST answer 412 and touch nothing without `confirm: true`), the BFF serves the three routes on a shared `core/activity` engine (CLI verbs byte-identical), and Settings → Project offers install/uninstall for the active lens, with the real-time toggle hinting when the hook is missing.

## User-facing

**Wire the activity hook from Settings.** Install or remove the live-activity hook for your assistant right from Settings → Project, with a clear confirmation before anything touches your files. The real-time toggle now tells you when the hook is missing.
