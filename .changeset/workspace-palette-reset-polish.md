---
"@skill-map/cli": patch
---

Polish on the fused workspace: the floating kind / severity / favorites palette counts now reflect the files-rail curation (filtering from the tree reshapes the numbers); selecting a file whose node is hidden from the map no longer pans the camera to empty space; the layout reset only prompts when the user has actually positioned nodes and the warning is lower intensity; and the link-kind palette lists every link kind regardless of node curation.

## User-facing

The map palettes now count only the nodes you've curated visible. Selecting a hidden file no longer jumps the camera to empty space, and "Re-arrange layout" only asks to confirm when you have moved nodes yourself.
