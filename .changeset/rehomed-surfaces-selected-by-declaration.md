---
"@skill-map/cli": minor
---

The three curation built-ins (`core/node-bump`, `core/node-set-stability`, `core/node-set-tags`) declare their re-homed `surface` in the action-button payload, and the UI now selects the header version and stability chips, the tag row, and the card's version label and tag chips by that declaration instead of matching extension ids; the card version label thereby follows the Bump extension's enabled state like the other surfaces.

## User-facing

**The card version label follows its plugin.** The version label on map cards now appears only while the Bump extension is enabled, matching how the version and stability chips and the tag row already follow their plugins.
