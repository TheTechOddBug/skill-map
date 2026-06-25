---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The vendor-neutral open-skills Provider (`agent-skills`, lens "Open Skills") gains an open-standard base reserved-name catalog under `skill`: a user skill shadowing a universal built-in like `help`/`config` is now flagged by `core/name-reserved`, and Antigravity inherits the base by manifest composition and appends its own verbs. Its `skill` frontmatter schema now enforces the open-standard `name` pattern/length and `description` length. Shared primitives renamed to a `COMMONS_*` vocabulary.

## User-facing

With the Open Skills lens active, a skill you authored that shares a name with a built-in command (like `help` or `config`) now gets a warning, and skill names or descriptions that break the open-standard format (bad characters, too long) are flagged too.
