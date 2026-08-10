---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The slash and at-mention token grammars now require at least one letter in the identifier, so purely numeric prose tokens (`total /10`, `@10/20`) no longer produce false-positive reference-broken findings; digit-leading names (`/2fa-setup`) and numeric filenames (`@10.md`) keep matching. Mirrors the guard the dollar grammar already had for currency.

## User-facing

Fractions and scores written in prose ("total /10", "@10/20") are no longer mistaken for command or mention references, so they stop showing up as broken-reference errors.
