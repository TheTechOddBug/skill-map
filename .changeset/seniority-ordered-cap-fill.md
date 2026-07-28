---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

The map's render cap now fills by selection seniority: with the root excluded and two or more includes, `/api/branch` orders nodes by the first include (in `path=` request order) that admits them, then path, so folders selected first keep their nodes when a later selection overflows the cap; every other scope shape keeps plain path order. The include order travels the whole pipeline and the spec gains the normative Seniority fill rule under §Map scope overrides.

## User-facing

When your folder selection has more nodes than the map can draw, the folders you selected first now stay on the map and the newest selection fills whatever room is left, instead of everything competing alphabetically.
