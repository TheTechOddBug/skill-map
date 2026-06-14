---
"@skill-map/cli": patch
---

Consolidate `core/reference-redundant` onto the kernel's `link.resolvedTarget` (stamped by the post-walk lift) instead of rebuilding its own name index, deleting the duplicated `buildNameIndex` / `collectIdentifiers` / `resolveTargetPath` machinery. Grouping now tracks the resolved graph; a trigger that matches a name but fails the strict kind matrix is no longer grouped as redundant (that mismatch is `core/link-conflict`'s concern). The three documented redundancy cases are preserved.
