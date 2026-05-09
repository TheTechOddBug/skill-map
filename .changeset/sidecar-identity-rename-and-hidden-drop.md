---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

**Mental model.** A `.sm` sidecar is, conceptually, the annotations file for its `.md` node — every key under it is an annotation. The YAML root organises those annotations into structural blocks: `identity` (anchor + drift hashes), `annotations` (curated catalog), `audit` (timestamps), `settings` (reserved), and `<plugin-id>:` namespaces. The schema and docs now lead with that framing.

**`for:` → `identity:`.** The block was always semantically about anchoring the sidecar to its node and tracking drift hashes — `for:` was concise but cryptic and got mistaken for "metadata about the node". Renamed to `identity:` everywhere: schema, parser, store, bump action, scaffold helper, fixtures, docs, UI debug panel.

**`hidden` removed.** The curated catalog declared `annotations.hidden` for "exclude from default listings" but nothing in the runtime ever consumed it (no `--include-hidden` flag, no list filter). Dead spec surface. Dropped from the schema; the catalog now stands at **13 fields**. The matching UI rendering is gone too.

**Surface changes**

- `spec/schemas/sidecar.schema.json` — top-level `for` property renamed to `identity`; `required: ['for']` → `required: ['identity']`. Root description updated to lead with the "annotations file" mental model. `$defs.identity` was already named correctly; only the property reference moved.
- `spec/schemas/annotations.schema.json` — `hidden` property removed. Description bumped from "load-bearing 14 fields" to "13 fields".
- `spec/schemas/node.schema.json` — `Node.sidecar.root` description updated: reserved blocks list now reads `identity / annotations / settings / audit`; example sub-paths use `root.identity.*`.
- `spec/architecture.md` — § Annotation system rewritten to lead with the mental model; identity contract uses `identity.path` / `identity.bodyHash` / `identity.frontmatterHash`. `display (hidden)` dropped from the curated-catalog enumeration.
- `spec/cli-contract.md`, `spec/plugin-author-guide.md` — example sidecars use `identity:` blocks.
- `spec/conformance/fixtures/**/*.sm` — three fixture sidecars updated.
- `src/kernel/sidecar/parse.ts` — reads `root['identity']`; `IParsedSidecar` fields `forBodyHash` / `forFrontmatterHash` / `forPath` renamed to `identityBodyHash` / `identityFrontmatterHash` / `identityPath`.
- `src/kernel/orchestrator.ts` — drift detection consumes the renamed fields.
- `src/built-in-plugins/actions/bump/index.ts` — patch object emits `identity:` instead of `for:`.
- `src/built-in-plugins/rules/unknown-field/index.ts` — `RESERVED_ROOT_BLOCKS` set updated.
- `src/cli/commands/sidecar.ts` — `sm sidecar refresh` and `sm sidecar annotate` write the renamed block.
- `ui/src/app/components/inspector-debug-panel/*` — `forBlock` / `IForBlock` renamed to `identityBlock` / `IIdentityBlock`.
- `ui/src/app/components/annotations-panel/*` — `hidden` rendering removed (template, taxonomy section, texts catalog, spec).
- All test fixtures (`src/test/**`, UI specs, e2e) updated to use `identity:` blocks.

**Migration**: every `.sm` file in the wild that uses the old `for:` block is now invalid against the schema. The right fix per node:

- Open the `.sm`.
- Rename the top-level key from `for:` to `identity:` (no value changes).
- Save.

A future `sm migrate` action could automate this; for now manual edit is the path. The kernel's parser will fail closed (`invalid-sidecar` issue) on a non-renamed file, so missed migrations surface at scan time.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
