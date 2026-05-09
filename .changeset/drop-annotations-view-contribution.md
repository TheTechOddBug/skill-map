---
"@skill-map/cli": minor
---

Drop the `parsed` view contribution from `core/annotations`.

The extractor declared `viewContributions: { parsed: { contract: 'per-node-key-values', label: 'Frontmatter', ... } }` and emitted a flat key/value projection of the frontmatter top-level scalars to the inspector. With the inspector card already surfacing `title`, `description`, `version`, and `stability` as first-class node fields denormalised by the kernel, the panel was a redundant copy of data the user already saw one click higher. Reclassified as a misadopter of the view contribution system: contributions are for plugin-derived data, and frontmatter scalars live on `node.frontmatter` as a first-class kernel field served directly by the BFF.

**Surface changes**

- `src/built-in-plugins/extractors/annotations/index.ts` — `viewContributions` block removed, `ctx.emitContribution('parsed', ...)` call removed, `scalarFrontmatterEntries` helper removed. Module docstring updated. Extractor is now single-purpose: emits links from sidecar annotations.
- `src/built-in-plugins/README.md` — inventory row updated.
- `ROADMAP.md` — built-in adopter list and decision table reflect that only `core/external-url-counter` survives as a built-in adopter.

**Persistence**: no SQL migration. The `scan_contributions` table's catalog sweep (`replaceAllScanContributions` with `registeredContributionKeys`) drops orphan rows whose `<plugin_id>:<extension_id>:<contribution_id>` triple is not in the live catalog; rows for `core:annotations:parsed` go away on the next scan.

**UI**: the `<sm-view-contributions-host>` slot host is unaffected (no slot binds to `core/annotations:parsed` specifically). The `per-node-key-values` contract and its renderer (`PerNodeKeyValues` in `ui/src/app/contracts/contract-renderer-map.ts`) stay in the closed catalog — available for future adopters, just not consumed by any built-in extension today.

**Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0. Users who relied on the "Frontmatter" inspector panel: the data shown there (`title`, `description`, etc.) is already rendered on the node card directly; arbitrary custom frontmatter scalars are no longer surfaced — open the markdown file directly to read them, or wait for the upcoming inspector slot redesign.
