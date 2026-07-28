---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Closes a critical clone-and-scan vulnerability. Plugin import trust and the privileged project-local config keys lived inside `.skill-map/`, defended only by a `.gitignore` the repo author writes, so a hostile repo could ship a pre-granted plugin (arbitrary code on first scan) or a pre-enabled `scan.followExternalSymlinks`. Both now live in a scope lock anchored to that directory's filesystem identity, which git cannot transport, so a grant made elsewhere never verifies.

## User-facing

Security fix. Plugins and privileged local settings now only take effect where you approved them, so a repo you clone cannot pre-approve its own. After upgrading, re-run `sm plugins trust <id>` for plugins you use, and re-apply any local setting that stops taking effect.
