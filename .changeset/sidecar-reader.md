---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

**Storage extension.** Migration `002_sidecar_columns.sql` extends `scan_nodes` with three new columns: `sidecar_present` (INTEGER 0/1, default 0), `sidecar_status` (TEXT, NULL when absent or unparseable; one of `fresh` / `stale-body` / `stale-frontmatter` / `stale-both` otherwise), and `annotations_json` (TEXT, JSON-encoded `annotations:` block, NULL when absent or empty). The `Node` domain type gains a `sidecar` overlay that round-trips through `node.schema.json`; clients consume it as authoritative for the snapshot but never persist it across scans.

**Breaking change — `Node.version` type flip.** The denormalised version column was a `TEXT` semver string sourced from `frontmatter.metadata.version`; it is now an `INTEGER` monotonic counter sourced from sidecar `annotations.version` (Decision #125 — single integer, orthogonal to `stability`, no major-bump concept). Pre-9.6.2 rows reset to NULL on migration — greenfield, no automatic semver→integer conversion. `node.schema.json#/properties/version` updated accordingly.

**Source-of-truth shift for stability / version / author.** The three Node columns previously sourced from `frontmatter.metadata.*` / `frontmatter.author` now source from sidecar `annotations.{stability, version, author}`. Hard cut — the fallback through `pickMetadata` for these three fields is removed in `orchestrator.ts`. Other consumers of `metadata.*` (e.g. broken-ref's `metadata.related`) keep working; their migration lands in Step 9.6.4.

Coverage matrix rows 26 + 27 (sidecar + annotations schemas) flip from 🟠 deferred to 🟡 partial — kernel reader is covered; full bump-end-to-end (scan → annotation queryable → drift detection → bump) still lands in Step 9.6.6. New tests under `src/test/sidecar-reader.test.ts` cover fresh / stale-body / stale-frontmatter / orphan / malformed-YAML / schema-invalid / unknown-key paths and a persistence round-trip through `scan_nodes`.
