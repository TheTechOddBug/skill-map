---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Redesign the link-confidence scoring model: the kernel seeds a 1.0 baseline on every link (the per-extractor emit floor is dropped) and the score-phase detectors subtract a fixed penalty on top, so `core/name-reserved` lands a reserved link at 0.1 and `core/reference-broken` a broken one at 0.5, while disabling a detector leaves its link at 1.0. The built-in `core/score-resolution` analyzer is deleted (its 1.0 is now the baseline), so a clean resolved link records no `scan_link_scores` row.

## User-facing

**Link confidence now starts at 1.0 and each rule subtracts a fixed amount.** A clean link reads 1.0, a reserved one 0.1, a broken one 0.5. Turning a rule off leaves its links at full confidence. The internal score-resolution scorer was retired.
