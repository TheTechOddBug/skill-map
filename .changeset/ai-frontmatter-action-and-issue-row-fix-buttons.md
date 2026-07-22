---
"@skill-map/cli": minor
---

New built-in `core/ai-frontmatter-action` (experimental, ships disabled) generates or completes a node's missing frontmatter (path-aligned `name`, use-when `description` in the body's language) without overwriting existing fields, gated by the new `frontmatterMissing` precondition so complete files never list it; deterministic-analyzer fixers moved out of the standalone launcher row and now render as a fix button on each matching deterministic issue row.

## User-facing

**AI can fill in missing frontmatter.** A new AI action writes the name and description a file is missing, and only appears while something is actually missing. Fix buttons for scan warnings now sit on the warning row itself instead of a separate launcher row.
