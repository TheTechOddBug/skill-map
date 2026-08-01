---
'@skill-map/cli': minor
---

The `sm refresh` verb is now `sm enrich` (command, texts catalog, report schema, envelope kind and operations-log slug all follow); the old name is removed, not aliased. Separately, `sm scan <some-file.md>` used to fail with "does not exist or is not a directory" about a file that plainly exists; a path that exists but is a file now gets its own message explaining that roots are directories and naming the two verbs that do narrow (`sm enrich`, `sm scan --changed`).

## User-facing

`sm refresh` is now `sm enrich`. And pointing `sm scan` at a single file no longer claims the file does not exist: it explains that scan roots are directories and tells you which command to use for one node.
