---
'@skill-map/cli': patch
---

The inspector's AI-actions launcher buttons drop the hardcoded `secondary` severity so they track the theme's primary color like every other inspector action button; the Stop control uses the `danger` severity, matching its destructive intent.

## User-facing

The AI-action buttons in the inspector now match the app theme instead of rendering in a flat grey.
