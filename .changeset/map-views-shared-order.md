---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Map views gain a shared list order: a new optional `order` field in `map-view.schema.json` (contract in `spec/map-views.md` §Ordering and shortcuts) drives the `GET /api/map-views` sequence (order ascending, absent last, slug tiebreak), the switcher list is drag-reorderable (renumbering compactly and re-writing only the changed view files), and the first nine positions surface their digit-shortcut number on the row.

## User-facing

Drag views up and down in the view selector to order them; the order is saved in the view files, so your team gets the same sequence. The first nine views show their number and keys 1-9 switch straight to them.
