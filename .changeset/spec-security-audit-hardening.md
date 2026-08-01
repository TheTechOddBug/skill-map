---
"@skill-map/spec": minor
---

Security-audit hardening of the contract. `allowNetworkActions` is reclassified into `PROJECT_LOCAL_ONLY_KEYS`, so a value in the committed `settings.json` is now stripped with a warning and each operator re-opts in with `sm config set allowNetworkActions true`. The live watcher must observe the same realpath-containment gate as the walk, and `--plugin-dir` must warn that it loads code without the import-trust gate.
