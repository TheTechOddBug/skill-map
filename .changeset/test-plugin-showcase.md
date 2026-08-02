---
"@skill-map/cli": minor
---

New built-in plugin `test-plugin` with one extension, `showcase`: a settings showcase declaring one setting per input-type in the closed catalog, so every control can be exercised end to end (Settings form, CLI writes, resolver validation, storage routing). Ships disabled by default (deliberate opt-in, no experimental badge); enable with `sm plugins enable test-plugin/showcase`. A companion spec pins the showcase to the full catalog, so a future input-type cannot ship without joining it.
