---
"@skill-map/cli": patch
---

Resolved the app-ruler UI audit findings: migrated the files-tree row animation from the deprecated @angular/animations DSL to the native animate.enter/animate.leave CSS API (dropping the @angular/animations dependency), hardened UI service signals to read-only exposure, and consolidated the duplicated frame-scheduling and panel-resize helpers into shared modules.
