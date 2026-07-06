---
"@skill-map/cli": patch
---

Internal cleanup from a cli-ruler compliance pass: built-in plugin string catalogs renamed from `text.ts` to `<extension-id>.texts.ts` so the em-dash lint gate covers them, the frontmatter-yaml and toml parsers share one parse-error sanitiser (the TOML side now also strips DEL bytes), dead legacy metadata projectors dropped from node-build, the activity templates interpolate the shared `.skill-map` path constants, and the BOM heuristic's key-line probe is bounded to 4 KB.
