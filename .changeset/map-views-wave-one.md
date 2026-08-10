---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Named map views: human-curated map topology (visibility overrides plus pinned node positions, with a reserved groups surface) now persists as committed files under `.skill-map/views/<slug>.json` per the new `spec/map-views.md` contract and `map-view.schema.json`, written and served through the new `GET/PUT/DELETE /api/map-views` endpoints; the web UI gains a view switcher with save, save as, exit views, a dirty-switch confirmation (`ui.confirmViewSwitch`) and `?view=` deep links.

## User-facing

You can now save the map you curated as a named view and commit it, so your team gets the same map: same hidden folders, same pinned nodes. Switch views from the new selector on the graph, share one with a link, and save changes explicitly when you are ready.
