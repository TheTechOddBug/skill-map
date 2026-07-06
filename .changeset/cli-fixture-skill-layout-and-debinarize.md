---
"@skill-map/cli": patch
---

The minimal-claude conformance fixture moves its skill from the flat `.claude/skills/hello.md` (which classified as `markdown`) to the directory layout `.claude/skills/hello/SKILL.md`, so the basic-scan case exercises one node per kind as intended; alongside, raw control bytes embedded in the frontmatter-yaml and toml parsers and in safe-text were replaced with escape text, with identical compiled patterns and no behavior change.
