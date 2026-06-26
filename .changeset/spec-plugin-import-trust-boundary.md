---
"@skill-map/spec": minor
---

New normative import-trust boundary for project-local plugins: a drop-in plugin under `<cwd>/.skill-map/plugins/` is discovered but its extension code is NOT imported or executed by the runtime verbs until the operator grants local trust via `sm plugins enable <id>`. The committed `settings.json` baseline cannot grant it, so cloning and scanning a repo no longer auto-executes its plugins; built-ins and `--plugin-dir` stay ungated. Defined in architecture.md §Locality.
