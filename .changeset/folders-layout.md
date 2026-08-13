---
'@skill-map/cli': patch
---

New path-derived graph layouts, and "Folder (compact)" becomes the default a map opens with. Column is path depth, edges are ignored, and the two variants differ only in where a folder's own files go: level with the folder, or under its subfolders like the files panel lists them. Both use their own tighter gaps, since a layout that draws no edges reserves no room to route them. They answer the case dagre cannot: few references means every node lands in rank 0, one endless column.

## User-facing

Two new layouts arrange the map like your file tree instead of by links, and "Folder (compact)" is now what a new map opens with. If you already picked a layout, yours is kept.
