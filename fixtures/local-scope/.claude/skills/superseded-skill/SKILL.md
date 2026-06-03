---
name: superseded-skill
description: "Retired Claude skill kept on disk for historical reference. Demonstrates the `stability: deprecated` + `supersededBy` pattern — supersession is encoded in the sidecar so the graph renders the replacement arrow."
when_to_use: Do not invoke; superseded by #full-skill-claude.
---

# Superseded Claude skill

Old version of the canonical Claude skill. Pointed at by `supersededBy` in its sidecar, which targets #full-skill-claude. The graph view should render a supersession edge from this node to the newer one.
