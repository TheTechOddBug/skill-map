---
name: help
description: "Fixture skill whose name collides with the built-in Claude slash command `/help`. Any reference to it resolves on disk but the runtime shadows it with the built-in, so the edge is downgraded to the reserved-target confidence (0.1). Exists to give the skills column a reserved-name example and to feed the `core/name-reserved` warn under the claude lens."
---

# help

Reserved-name demonstrator (the skill sibling of `review.md`). Its name shadows the built-in `/help`, so `core/name-reserved` raises a warn on this node, and an edge pointing here resolves but lands at confidence 0.1 (reserved) instead of 1.0.
