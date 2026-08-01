---
'@skill-map/spec': minor
---

Retires `POST /api/sidecar/bump`, which the server stopped serving when the generic Action dispatch replaced it, and documents `POST /api/actions/:pluginId/:actionId` in the endpoint table for the first time; the `sidecar.bumped` envelope kind and the `sidecar-fresh` 409 code go with it. The global-flag table gains `--version`, `--log-level` and `SKILL_MAP_LOG_LEVEL`, and states that global flags bind no position.
