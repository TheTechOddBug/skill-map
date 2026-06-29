---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Fold the project `.gitignore` into the scan and watcher ignore filter (precedence: bundled defaults, `.gitignore`, `config.ignore`, `.skillmapignore`, where later layers may `!`-re-include) and scope the live watcher to only the file types a scan opens: the registered providers' `read.extensions` (`.md` everywhere, `.toml` under codex) plus `.sm` sidecars. A provider that ships a custom walker disables the extension gate.

## User-facing

**Quieter live map, cleaner scans.** The scan and live map now also respect your project's `.gitignore`, and the live watcher only reacts to `.md`, `.toml`, `.sm`, and `.skillmapignore` changes, so edits elsewhere (including `node_modules`) no longer cause a rescan.
