---
"@skill-map/cli": patch
---

Polish `sm init`, `sm bump`, and `sm hooks install pre-commit-bump` human output to share the green ✓ glyph rhythm of the rest of the CLI. Each success line — gitignore update, .skill-map/ provisioning, first-scan summary, single-node bump (with or without sidecar creation), pre-commit hook install / chain / already-installed — now opens with `✓`. Pluralised nouns in the first-scan summary (`1 node` / `N nodes`) replace the old `(s)`-suffix style. No flag surface change; `--json` paths unchanged.
