---
'@skill-map/cli': minor
---

New finder/fixer pair `core/ai-prose-to-rules-analyzer` + `core/ai-prose-to-rules-action` (stable, enabled): the finder flags spans where two or more normative directives hide inside narrative paragraphs and its finding detail carries the extracted checklist ready to paste; the fixer applies the conversion in place. `ai-structure-analyzer` ceded the prose-should-be-a-list territory in the same change, narrowing its axis to placement, ordering and hierarchy.

## User-facing

New AI action: skill-map now spots rules buried inside paragraphs (musts, nevers, step orders) and proposes them as an explicit checklist you can apply with one click, alongside the other finders in the inspector.
