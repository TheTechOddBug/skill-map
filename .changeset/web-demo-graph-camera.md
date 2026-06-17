---
"@skill-map/web": patch
---

Force a public demo redeploy so the embedded skill-map app picks up the latest graph map UI: clicking a tag on a card no longer pans or zooms the camera, and the re-arrange / fit buttons now glide instead of snapping. The demo bundles the current UI build (it is not committed, it is rebuilt at deploy time), so this web bump is what carries those already-shipped CLI changes to the public site.
