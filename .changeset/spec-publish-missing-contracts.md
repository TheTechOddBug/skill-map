---
'@skill-map/spec': minor
---

Three normative prose contracts were missing from the published package: `input-types.md`, `view-slots.md` and `mcp-server.md` were absent from `files`, so they never reached the npm tarball or the integrity block, despite being linked from the plugin author guide. They now ship and are hashed with the rest.
