---
"@skill-map/cli": minor
---

The `ai-structure` and `ai-trigger` optimization pairs (finder analyzer plus fixer action each) graduated from experimental to stable and now ship enabled by default, after each proved its prompts end to end in the live playground; the trigger and scope finder prompts now instruct the agent to read the live file for the frontmatter `description`, since the job snapshot carries the body only. Only the `ai-scope` pair stays experimental and disabled.

## User-facing

**Structure and description-check reviews now come enabled out of the box.** Both show up on every file's AI actions row with per-finding fixes, and the description check now reads a file's frontmatter so it actually sees the description it audits.
