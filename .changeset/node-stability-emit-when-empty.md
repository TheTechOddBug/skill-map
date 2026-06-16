---
"@skill-map/cli": patch
---

The `node-stability` experimental / deprecated card-footer chips were being suppressed: `card.footer.right` is a counter slot that treats `value: 0` as empty, and the contributions set `emitWhenEmpty: false`, so the badges never rendered. They now emit-when-empty and show again as icon-only badges (the `fa-flask` / `pi-ban` icon carries the meaning, value is always 0).

## User-facing

The experimental / deprecated badge on a node's card now shows again.
