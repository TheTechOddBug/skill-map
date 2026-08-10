---
'@skill-map/cli': minor
'@skill-map/spec': patch
---

Line numbers in findings and link locations are now file-absolute (the frontmatter block is counted, matching the editor), the inspector's Raw view shows the on-disk file verbatim via the new `GET /api/nodes/:pathB64?include=raw` so its gutter lines up with the reported `L<n>`, and a middle-mouse pan on the graph background no longer clears the current selection.

## User-facing

Line numbers in findings (L12) now match your editor: they count the frontmatter block. The inspector's Raw view shows the whole file including the frontmatter, so its line gutter lines up. Panning the map with the middle mouse button no longer clears your selection.
