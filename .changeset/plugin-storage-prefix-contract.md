---
'@skill-map/spec': major
---

`plugin-kv-api.md` and `db-schema.md` described prefix INJECTION for plugin migrations (the kernel rewriting `CREATE TABLE <name>` into `plugin_<id>_<name>`), which no implementation has ever done: the namespace is ENFORCED, and an unprefixed object is refused. Both contracts now say so, and note that the check is a literal string prefix, so the kernel `ix_` / `fk_` / `uq_` / `ck_` conventions cannot lead a plugin object name.
