---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

The `sm plugins` management family (`list` / `show` / `enable` / `disable` / `trust` / `untrust` / `doctor` / `config`) now honours the import-trust gate instead of importing project-local plugin code unconditionally, which made `sm plugins list` the shortest clone-and-scan path to a hostile repo's code and `sm plugins trust` run the code it was asking consent for. Manifest fields survive the gate, `--plugin-dir` stays exempt, and the spec drops its stale `config_plugins` trust references.

## User-facing

**Untrusted plugins stay unexecuted everywhere.** Every `sm plugins` command, `list` included, refuses to run a project-local plugin's code until you have trusted it. You still see its id, description and path; `sm plugins trust <id>` unlocks the rest.
