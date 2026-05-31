---
"@skill-map/cli": patch
---

Restore the left-to-right order of the `card.footer.right` chip cluster that the `core/issue-counter` aggregate had displaced: the stability badge leads (priority 10), then the stale-drift clock chip (priority 20), then the warning and error counters anchor the right edge. A reader notices it as the card-footer status icons returning to lifecycle, stale, warnings, errors order.

## User-facing

**Card footer icon order restored.** The status icons in the bottom-right of each card are back to their previous order: lifecycle/stability first, then the stale indicator, then warnings and errors on the far right.
