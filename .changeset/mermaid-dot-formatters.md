---
'@skill-map/cli': minor
---

`sm graph --format mermaid` and `--format dot` now work, as does `sm export --format mermaid`. The CLI contract had documented all three since before any existed, so they failed with exit 2 and "No formatter registered". Output is deterministic and escaped against each language's real rules: Mermaid ids are synthetic because `-` and `.` are edge-token characters, and DOT escapes the backslash before the quote so a path cannot render as the node name.

## User-facing

`sm graph --format mermaid` and `--format dot` render the map as a diagram you can paste into a GitHub markdown file or feed to Graphviz. `sm export --format mermaid` does the same for a filtered subset.
