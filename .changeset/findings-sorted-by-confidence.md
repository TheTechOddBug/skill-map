---
"@skill-map/cli": patch
---

The inspector's AI finding rows now sort by confidence descending inside each severity tier, instead of leaving same-severity rows in the tray's arrival order. Severity remains the primary key (error, warn, info) and equal-confidence rows keep their incoming order; the deterministic issue rows above them are unchanged, they carry no confidence.

## User-facing

In the Findings card, findings of the same severity are now listed with the most confident ones first.
