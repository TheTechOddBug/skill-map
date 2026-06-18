---
"@skill-map/cli": patch
---

Refactor the bundled `sm-tutorial` skill so fixture-file generation and progress tracking run as two zero-dependency Node scripts inside the skill (`scripts/state.js`, `scripts/fixtures.js`) reading a single `fixtures-data/` source of truth, instead of the agent reproducing fixture content verbatim and hand-editing a YAML state file each chapter. State moves to `tutorial-state.json` fed by a generated `references/_manifest.json` sidecar; tester-facing narration is unchanged.
