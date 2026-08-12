---
'@skill-map/cli': patch
---

New "Folders" graph layout that arranges nodes by the directory tree their paths imply instead of by edges: column is path depth, and a folder's contents sit beside, and never above, the folder that holds them, while each column still packs from the top so the canvas stays compact. It answers the case dagre cannot, a corpus with many nodes and few references between them, where every node shares rank 0 and stacks into one endless column.

## User-facing

The layout picker gains "Folders", which lays the map out like your file tree: root files on the left, each folder's contents to its right. Useful on a project whose files barely reference each other, where the other layouts pile everything into one tall column.
