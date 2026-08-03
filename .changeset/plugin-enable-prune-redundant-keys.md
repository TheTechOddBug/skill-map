---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

The plugin enable toggle no longer restates the defaults in `settings.json`. `sm plugins enable / disable` and the `PATCH /api/plugins...` routes skip a per-extension `enabled` key whose state the id already resolves to without it, drop one that turned redundant, and sweep the layer they write for keys left by the previous always-write behaviour. A `--local` re-enable over a committed `false` still persists. Spec: `architecture.md` §Locality.

## User-facing

Turning a plugin off and back on used to leave a line behind in `.skill-map/settings.json` for every flip. Now the file only keeps the settings that actually differ from the defaults, and it cleans up the leftovers the next time you toggle anything.
