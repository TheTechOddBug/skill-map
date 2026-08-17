---
'@skill-map/spec': patch
---

The `node.schema.json` and `project-config.schema.json` description strings now name the supported token encodings (`cl100k_base`, `o200k_base`) instead of the `js-tiktoken` library, which the CLI no longer uses; the enum and every normative shape are unchanged.
