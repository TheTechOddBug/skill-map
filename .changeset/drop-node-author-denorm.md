---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

**Spec.** `spec/schemas/node.schema.json` no longer documents the `author` property. `spec/architecture.md` § "Read path (denormalization)" lists two columns instead of three (`stability`, `version`). `spec/db-schema.md` § scan_nodes drops the `author` row. `spec/index.json` regenerated.

**Kernel.** `Node.author` removed from the runtime type and `IScanNodesTable.author` removed from the SQLite schema. `applyAnnotationsOverlay` no longer reads `annotations['author']`; the cache-hit reset in `runScan` no longer clears `node.author`; `buildNode` no longer initialises the field. New migration `003_drop_node_author.sql` issues `ALTER TABLE scan_nodes DROP COLUMN author;` (SQLite 3.35+ — node:sqlite ships ≥ 3.45). `scan-persistence.ts` and `scan-load.ts` no longer write or read the column.

**CLI.** `sm show` no longer renders an `author:` row in the node header. `SHOW_TEXTS.nodeFieldAuthor` removed. The built-in `validate-all` rule's `toNodeForSchema` no longer copies `author` over to the wire shape it validates against.

**Tests.** `sidecar-reader.test.ts`, `storage.test.ts`, `node-enrichments.test.ts`, `server-query-adapter.test.ts` updated. The fresh-sidecar fixture in `sidecar-reader.test.ts` no longer writes an `author:` annotation (rides on `additionalProperties: true` if anyone keeps writing it informally; not a denorm-source anymore).

**Greenfield.** No automatic salvage path. Pre-9.6.2 rows had the column reset to NULL by migration 002. Anyone who later wrote `author:` in their `.sm` keeps the value verbatim under `scan_nodes.annotations_json`; the `unknown-field` rule warns on the key as a typo guard.

**Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) remains a separate task; the UI's `INodeApi.author` optional field is not consumed by any service / view, and the BFF will simply never produce it after this change. Rip-out lands with the inspector tiering pass.
