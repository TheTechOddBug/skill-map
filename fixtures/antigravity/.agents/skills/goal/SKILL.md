---
name: goal
description: Intentionally named after the built-in /goal command to demo the reserved-name analyzer.
---

# Goal (reserved-name collision)

This skill is named `goal`, which shadows Antigravity's built-in `/goal`
slash command. The `core/name-reserved` analyzer flags it under the
antigravity lens (self scope: the skill classifies as `antigravity`/`skill`
and `/goal` is in the reserved catalog). Rename it to make it invocable.
