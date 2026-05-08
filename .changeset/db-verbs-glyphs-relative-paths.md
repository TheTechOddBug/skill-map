---
"@skill-map/cli": patch
---

Polish `sm db backup` / `sm db restore` / `sm db reset` / `sm db migrate` human output: prefix every success line with the green ✓ glyph, render DB / backup / target paths relative to cwd when they sit under it (so the user sees `.skill-map/skill-map.db` instead of the absolute `~/projects/.../skill-map.db`), and add the same glyph to the `kernel · …` and `plugin <id> · …` migration status lines so a glance is enough to confirm "everything ok". Failure paths still emit on stderr without a glyph (existing UX). No flag surface change.
