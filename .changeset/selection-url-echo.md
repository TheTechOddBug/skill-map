---
'@skill-map/cli': patch
---

Fix a race in the graph view's selection/URL sync that could re-open the inspector on the node you had just closed. The writer mirrors the selection into `?path=`, and the reader could not tell that query-param change from an incoming deep link, so whenever it first observed the param after the selection had already been cleared it "restored" it. The writer now claims the value it pushes and the reader swallows its own echo; genuine deep links are unaffected.
