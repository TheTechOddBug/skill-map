---
"@skill-map/web": patch
---

The public demo build now wipes `web/demo/` before regenerating it, so stale hashed bundles no longer accumulate across rebuilds (the directory had grown hundreds of orphaned `chunk-*.js` / `main-*.js` / `styles-*.css` files) and the demo always ships exactly the current build's assets.
