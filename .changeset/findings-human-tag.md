---
"@skill-map/cli": patch
---

Fixed findings whose resolution involved the operator now wear an at-a-glance `(human)` marker beside the row, the same inline treatment `(stale)` gets: cyan in the CLI listing, the theme's primary color as a chip in the inspector's fixed bucket. The data was already there (`resolution_actor`); only the glance was missing.

## User-facing

Findings you decided yourself (approved a fix, picked an option, resolved by hand) now show a "human" tag next to them, so your calls stand out from the fixer's autonomous ones.
