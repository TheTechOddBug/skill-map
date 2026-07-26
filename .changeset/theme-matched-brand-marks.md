---
'@skill-map/cli': patch
---

Every extra theme now ships its own retinted brand mark: new `skill-map-mark-neon/neon-green/neon-red.svg` assets follow the matrix recipe (strokes in the theme's secondary tone, bottom node in the electric accent), and mark selection was centralized in `ThemeService.markSrc` so the topbar and the Settings About tab always agree (About previously ignored extra themes entirely).

## User-facing

The skill-map logo now matches the active theme: the neon cyan, green, and red themes each get a logo tinted in their own colors, both in the top bar and in Settings.
