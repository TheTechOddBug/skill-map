---
"@skill-map/cli": patch
---

Internal quality pass from a review. The kernel no longer imports the `core/` runtime layer: pure leaves (`atomic-write`, `schema-fingerprint`, `update-check`, the `SKILL_MAP_DIR` literal, the provider detector) moved into `kernel/` and the sidecar consent gate is now injected, with a new lint rule enforcing the boundary. The BFF's two `409` responses dispatch via a typed `ConflictError` instead of a message-prefix match, and `sm scan`'s count nouns moved into the i18n catalog.
