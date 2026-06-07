---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The `sm tutorial` verb drops its `master` positional variant and now materializes a single `sm-tutorial` skill, restructured into a "book" of ordered parts and chapters with a manifest-driven menu. The advanced walkthrough (plugins, settings, view-slots) and the CLI deep-dive are parts inside that one skill, reached from its menu after the live-UI prologue. `sm tutorial master` exits 2; `.claude/skills/sm-master/` is removed.

## User-facing

`sm tutorial master` is gone. Run `sm tutorial`: the advanced parts (plugins, settings, view-slots) and the CLI in depth are now chapters you pick from a menu inside the tutorial, after the live-UI prologue.
