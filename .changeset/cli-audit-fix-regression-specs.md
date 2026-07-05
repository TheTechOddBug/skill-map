---
"@skill-map/cli": patch
---

Added regression specs pinning two audit fixes: fatal-path errors keep landing on stderr under `--json` / `-q` (stdout stays clean for the JSON contract), and the `-v` verbose logger writes to the Clipanion context stderr instead of `process.stderr`. Test-only, no runtime change.
