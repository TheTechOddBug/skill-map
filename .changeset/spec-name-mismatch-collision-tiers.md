---
"@skill-map/spec": minor
---

architecture.md §Provider · kind identifiers now specifies the per-kind `identifierMismatch` knob and the `core/name-mismatch` contract: a node whose normalised `frontmatter.name` diverges from its filename/dirname handle is flagged with the kind's declared severity (warn for the open-standard skill kind, info for documented-legal overrides). It also defines the two-tier `core/name-collision` verdict: error for two declared names, warn for declared-vs-file-derived shadowing.
