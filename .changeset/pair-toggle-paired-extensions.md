---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Enable/disable now applies a pair toggle over Modelo B edges: enabling a fixer action also enables the analyzer(s) in its `precondition.analyzerIds` (and vice versa), and disabling is reference-counted, so a companion falls only when its last enabled edge partner goes down. Covers `sm plugins enable / disable` and the `PATCH /api/plugins*` routes (bulk form keeps explicit-wins semantics). Normative wording in `plugin-author-guide.md` §Paired extensions.

## User-facing

**Reviews and their fixes now switch together.** Turning on a fix also turns on the review that feeds it, and turning off a review turns off its fix unless another review still uses it. No more half-armed pairs after toggling one side in the Settings panel or the CLI.
