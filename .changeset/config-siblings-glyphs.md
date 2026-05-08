---
"@skill-map/cli": patch
---

Polish `sm config get / set / show / reset` human output to share the visual rhythm of the rest of the CLI. Each success line now opens with the green ✓ glyph; the trailing `(wrote <path>)` and `(from <layer>)` suffixes are dim; settings paths render relative to cwd when they sit under it (so the user sees `.skill-map/settings.json` instead of an absolute path). No flag surface change; `--json` paths unchanged.
