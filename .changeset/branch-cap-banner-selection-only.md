---
'@skill-map/cli': patch
---

The map's render-cap banner now shows only while the CURRENT selection overflows the cap (`branch.truncated`); the corpus-wide fallback that kept the message up after narrowing to a fitting folder is gone, and the copy opens with "This selection has N nodes" instead of "This folder" since the rail scope can span several folders.

## User-facing

The map's node-cap banner no longer lingers after you narrow to a folder that fits, and its copy now says "this selection" instead of "this folder".
