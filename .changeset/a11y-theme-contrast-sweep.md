---
'@skill-map/cli': patch
---

WCAG AA sweep across all six UI themes, backed by a new automated axe-core + Playwright e2e suite (axe scan + a 1.4.11 border-contrast probe per theme). Per-theme input border and accent-text tokens now meet 4.5:1 / 3:1, the topbar version and lens chips and the demo banner link were recolored (the lens chip derives a readable shade from any provider hue), table row ARIA misuse was removed, the rail tablist now contains only tabs, and the refresh button gained a visible focus ring.

## User-facing

The interface now meets WCAG AA accessibility contrast in all six themes: input borders and highlighted text are easier to see, and keyboard focus on the refresh button shows a clear ring.
