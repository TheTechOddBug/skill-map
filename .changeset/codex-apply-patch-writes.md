---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The codex live-activity adapter now maps markdown writes: upstream shipped hook events for `apply_patch`, so the PreToolUse matcher includes it and each `.md` target named by the patch headers becomes a write signal (`access: 'write'`, `detail: 'apply_patch'`). The spec's codex row also documents the 0.147 hook-trust gate (a fresh install fires nothing until the operator trusts the hooks via `/hooks`) and re-verifies the still-open `read_file` gap.

## User-facing

On Codex, file edits now light the map and count as writes in recordings (Codex added hook support for its patch tool). Note: Codex 0.147 asks you to trust hooks via /hooks before any events flow.
