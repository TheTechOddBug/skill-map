---
"@skill-map/cli": patch
---

The claude and opencode live-activity adapters now capture markdown WRITES (Claude `Write`/`Edit`, opencode `write`/`edit`) alongside reads: an in-scope `.md` write emits the same filter-first PATH signal, with the literal tool name riding the existing `detail` field so the UI badge tells reads apart from writes; the installed claude hook matcher widens accordingly, while codex and antigravity writes stay unmapped per the spec rows.

## User-facing

**Edits light the map too.** When your agent writes or edits a markdown file, the map now lights that node the moment it happens, with a Write/Edit badge, instead of waiting for the next rescan. Re-run the activity hook install (or repair from Settings) to pick it up.
