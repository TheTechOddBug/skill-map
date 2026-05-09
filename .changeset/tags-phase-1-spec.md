---
"@skill-map/spec": minor
---

Tags · Phase 1 (spec only): declare the dual-source tag system.

Skill-map's tag system is dual-source by design — author tags live in `frontmatter.tags` (in the `.md`, intrinsic categories the file's author wrote) and user tags live in `sidecar.annotations.tags` (in the `.sm`, the post-hoc tags whoever curates the project assigned). Both surfaces are first-class; searches and listings match the union, and consumers distinguish them with explicit attribution.

This phase lands the spec changes. Persistence (`scan_node_tags` table), BFF projection (`node.tags = { byAuthor, byUser }`), CLI (`sm list --tag <name> [--tag-source author|user]`), and UI rendering follow in subsequent phases.

**Surface changes**

- `spec/schemas/frontmatter/base.schema.json` — `tags` declared as a universal optional field (array of non-empty strings). Per-vendor schemas extend the base via `allOf` + `$ref` so every Provider's per-kind schema accepts it without redeclaration. The intent: author tags belong in the markdown frontmatter, recognised across every vendor.
- `spec/schemas/annotations.schema.json` — `tags` description rewritten to clarify "user-supplied" semantics, point at `frontmatter.tags` as the sibling author surface, and document the dual-source posture (search union, optional `--tag-source` filter).
- `spec/architecture.md` § Annotation system → new "Tags · dual-source" subsection — explains the split, the persistence projection into `scan_node_tags`, the wire shape `node.tags = { byAuthor, byUser }`, and the deliberate omission from the kernel `Node` interface (consistent with the post-decision-#2 posture of "no Node-level denormalisations").
- `spec/db-schema.md` § Table catalog → new `scan_node_tags` entry — defines the table schema (`node_path`, `tag`, `source`), the PK, the `(tag)` index for search, and the replace-all-per-scan persistence semantics. Storage estimate documented (~7.5 KB for a 50-node project with avg 3 tags/node).
- `spec/index.json` regenerated.

No code changes in this phase. The tag system is entirely declarative on the spec side until the next phases land the persistence + query implementation.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
