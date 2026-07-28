---
"@skill-map/spec": patch
---

The `PATCH /api/project-preferences` path-exposure consent gate now documents that its 412 `confirm-required` envelope ships the exposed folders structured as `error.details.paths: string[]` beside the prose message (mirroring the sidecar gate's `details.key` precedent), so consent UIs can enumerate the list without parsing prose.
