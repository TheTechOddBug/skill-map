---
"@skill-map/cli": minor
---

Project-local plugins under `<cwd>/.skill-map/plugins/` are now discovered but their code is NOT imported or executed by the runtime verbs until the operator grants local trust with `sm plugins enable <id>`; the committed `settings.json` cannot grant it, so cloning and scanning a repo no longer auto-runs its plugins. Built-ins and `--plugin-dir` stay exempt. The BFF actions route also rejects a sidecar write whose path escapes the project root (400).

## User-facing

**Project plugins no longer run until you trust them.** Plugins committed in a repo's `.skill-map/plugins/` are now listed but not executed by `sm scan` / `sm serve` until you run `sm plugins enable <id>`, so cloning and scanning a repo no longer auto-runs its plugins.
