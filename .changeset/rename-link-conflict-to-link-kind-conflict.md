---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Rename the built-in analyzer `core/link-conflict` to `core/link-kind-conflict`. The rule flags two detectors emitting different `kind` values for the same `(source, target)` pair, so the id now names what it actually checks (a kind disagreement). Folder, id, texts, spec, and tests were renamed together, no compatibility alias. The rule also gains a `fix.summary` remediation hint (drop one conflicting source, or ignore the overlap deliberately).

## User-facing

**The `link-conflict` rule is now `link-kind-conflict`.** If you enabled or disabled it via `sm plugins`, re-apply the toggle under the new id; the old id is no longer recognized. The warning it raises is unchanged.
