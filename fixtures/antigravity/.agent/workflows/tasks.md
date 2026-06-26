---
description: Intentionally named after the built-in /tasks command to demo the reserved-name analyzer.
---

# Tasks (reserved-name collision)

This workflow is named `tasks`, which shadows Antigravity's built-in
`/tasks` slash command. Because workflows are slash-invocable, the
`core/name-reserved` analyzer flags it (the catalog applies to the
`workflow` kind, not only `skill`). Rename it to invoke it.

1. List open tasks

   `npm run tasks:list`
