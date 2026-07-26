---
'@skill-map/cli': patch
---

Every extra theme now declares its own favicon: new `favicon-neon/neon-green/neon-red.svg` assets follow the matrix stroke-ramp recipe and are wired through the theme registry's `favicon` field, so the browser tab glyph matches the active theme instead of falling back to the default violet mark.

## User-facing

The browser tab icon now follows the theme too: the neon cyan, green, and red themes each swap in a matching favicon while active, like matrix already did.
