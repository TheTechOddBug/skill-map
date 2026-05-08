---
"@skill-map/cli": patch
---

Redesign `sm orphans` / `sm orphans reconcile` / `sm orphans undo-rename` human output to match the visual rhythm of the rest of the CLI.

`sm orphans` (list) now opens with `sm orphans — N issues` and renders one yellow ⚠ row per issue, with `ruleId` + subject columns padded for alignment and the message dim. Empty state collapses to `✓ No orphan / auto-rename issues.` Tip line points at `reconcile` / `undo-rename` so the user knows the next move.

`sm orphans reconcile` renders a two-line success block — `✓ Reconciled <from> → <to>` followed by a dim breakdown row (`N rows · jobs N · execs N · summaries N · enrichments N · kv N · favorites N`). Dry-run swaps the glyph (⋯ yellow) and the verb, plus a dim `(dry-run)` tag at the end of the headline.

`sm orphans undo-rename` follows the same pattern: ✓ green / ⋯ yellow head line + dim body line.

No flag surface change; `--json` paths unchanged.
