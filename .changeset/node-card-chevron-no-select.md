---
"@skill-map/cli": patch
---

The node card's expand chevron now stops `mousedown` / `touchstart`, so the graph's pointer-down selection no longer fires when the card is expanded or collapsed; the `click`-time `stopPropagation` ran too late to prevent it.

## User-facing

**Expanding a card no longer opens the inspector.** Clicking the chevron on a card in the map now just expands or collapses it, without selecting the node and popping the inspector panel open.
