---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

A host-reserved `locked` manifest flag replaces the hardcoded kernel lock-list so the kernel names no plugin identity; five dedicated `inspector.surface.*` slots (version, stability, tags, summary, auto-tag) replace the retired payload-level `surface` re-homing field; the plugin listing wire gains a presentation `order`; and `GET /api/folders` severity badges now sum fresh unresolved findings alongside deterministic issues.

## User-facing

**The files tree now badges AI findings.** A file or folder with unresolved AI findings shows an error/warn badge in the tree, matching its card chips, not just deterministic checks. The `?debug=1` overlay also rings the version, stability, tags, summarize and auto-tag surfaces.
