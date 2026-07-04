---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The opencode adapter closes the four-provider live-activity set and implements the spec's `plugin-file` install kind: `sm activity install opencode` writes one self-contained in-process plugin at `.opencode/plugin/skill-map-activity.js` (wiring and bridge in a single marker-stamped file, a foreign file at that path is never touched) forwarding named skill / command / agent signals, markdown reads by path, and the native `session.idle` owner release (demo fixture: `fixtures/realtime-opencode/`).

## User-facing

**Live activity now covers OpenCode, completing the set.** Run `sm activity install opencode`: skills, commands and agents light up by name (even asked in prose), markdown reads glow by path, and each session goes dark the instant it idles.
