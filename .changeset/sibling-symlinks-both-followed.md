---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The walker's symlink cycle guard was a walk-global visited set, so the first directory link to reach a target claimed its realpath and every later link to the same target was silently dropped, when the contract promises in-tree links are always followed. Cycle detection is now a per-branch ancestor chain (sibling links each yield their own subtree), with a hard cap on symlinked-directory entries so a hostile diamond link graph cannot make the walk exponential. Spec wording clarified to match.

## User-facing

Two folder symlinks pointing at the same target now both appear on the map; before, only the first one scanned showed up and the other vanished silently.
