---
"@skill-map/cli": patch
---

The Settings resolution dialog had two nested scrollbars: the table sat in its own `max-height: 60vh` scroll box inside PrimeNG's already-scrollable dialog content. The wrapper is gone, so the dialog content is the single scrollport and the sticky column header sticks against it. The layer chip also renders `project-local` as `LOCAL`, which reads at chip size where the raw id did not.

## User-facing

The "Settings resolution" panel now has a single scrollbar instead of two, and the config layer column shows LOCAL instead of the harder-to-read PROJECT-LOCAL.
