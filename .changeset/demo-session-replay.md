---
'@skill-map/web': patch
---

The public demo's Sessions tab now ships a curated session recording of the demo fixture (a `/publish` run) and can REPLAY it on the map: the demo bundle bakes `sessions.json` next to `data.json`, and the replay lens (pure client-side playback over recorded frames) is available in demo mode while live watching and recording stay honestly disabled.
