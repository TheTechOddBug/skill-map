---
name: review
description: "Fixture command whose name collides with the built-in Claude slash command `/review`. Any reference to it resolves on disk but the runtime shadows it with the built-in, so the edge is downgraded to the reserved-target confidence (0.1). Exists to give the connections panel a low-confidence (red) example and to feed the `core/name-reserved` warn."
---

# review

Reserved-name demonstrator. Its name shadows the built-in `/review`, so an edge pointing here resolves but lands at confidence 0.1 (reserved) instead of 1.0, and `core/name-reserved` raises a warn on this node.
