---
"@skill-map/cli": minor
---

Scans now validate an ABSENT frontmatter block against the kind's schema: a claude/codex agent or open-standard skill with no frontmatter at all (or with its fence pushed off the first byte by preceding prose) gets the same `frontmatter-invalid` warning a partial block already got, while all-optional kinds (plain markdown, claude command/skill) validate the empty block clean and stay silent. Malformed-fence heuristics keep precedence, one issue per defect.

## User-facing

**Missing frontmatter is now flagged.** An agent or skill file with no frontmatter at all gets the same warning as one with incomplete frontmatter, including when stray text before the `---` fence made the metadata parse as body. Files that need no metadata stay quiet.
