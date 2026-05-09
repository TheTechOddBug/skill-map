---
"@skill-map/cli": patch
---

Apply the in-CLI visual style to `sm version`, `sm tutorial`, and the four `sm plugins enable / disable` rejection error messages.

`sm version` rows now render with a 2-space indent and a dim key column (`sm` / `kernel` / `spec` / `runtime` / `db-schema`), so the version values pop visually.

`sm tutorial` success body adopts the same shape as the rest of the CLI: green `✓` glyph + headline ("sm-tutorial.md created at ./<dir>/" with a dim relative path) + dim `English` / `Español` labels. The "already exists" / "could not read SKILL source" / "write failed" error paths get the red `✕` glyph + dim hint line.

`sm plugins enable / disable` reject paths (`granularity=bundle` rejects qualified id, `granularity=extension` rejects bare bundle id, unknown plugin id, qualified id under unknown bundle, unknown extension under known bundle) all reformatted to the same shape: red `✕` headline + indented secondary-line `Use ...` fix + dim hint line. Replaces the previous one-line dense error.

No flag surface change; `--json` paths unchanged. Test fixture in `cli.test.ts` updated to tolerate the new 2-space indent on the version matrix.
