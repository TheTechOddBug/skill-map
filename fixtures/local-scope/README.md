---
name: acme-toolkit
description: Fictional developer-assistance scope used by the ui prototype (Step 0c). Covers the live node kinds — skills, agents, commands, notes — with realistic frontmatter, sidecar annotations, and cross-references.
---

# acme-toolkit (demo fixture)

Fictional scope used as the build-time input for the SPA's static demo bundle (Step 14.3.b). The pipeline at `web/scripts/build-demo-dataset.js` runs `sm scan --json` over this directory and emits `web/demo/data.json` + `web/demo/data.meta.json`, which the `StaticDataSource` (demo-mode adapter) serves from the deployed bundle. The kernel itself is **not** swapped — `sm scan` runs as it would against any other scope.

Every `.md` carries vendor frontmatter conforming to `spec/schemas/frontmatter/*.schema.json`; skill-map annotations live in matching `.sm` sidecars (Step 9.6). Cross-references between nodes (the at-prefix for agents, the hash-prefix for skills, the slash-prefix for commands) drive the link graph so the demo exercises link detection without manual editing.
