---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Adds the `core/backtick-path` extractor: relative `.md` paths written inside inline code spans and fenced blocks become `references` edges, resolved like markdown links and deduped against them. The token grammar is pinned in `spec/architecture.md` (new section "Extractor: code-region file references"), unresolved targets surface via `core/reference-broken`, and the kernel exports `extractCodeRegions`, the exact inverse mask of `stripCodeBlocks`.

## User-facing

Skills that tell the agent to read a bundled doc with a backtick path (like `references/rules.md`) now show those arrows on the map, and a backtick path pointing at a missing file is flagged as a broken reference.
