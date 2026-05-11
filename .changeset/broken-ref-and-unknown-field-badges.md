---
"@skill-map/cli": minor
---

Surface `core/broken-ref` and `core/unknown-field` issues on the graph card, reshape `core/annotation-stale` to a single icon-only chip, and clean up the renderer chrome across `node-icon` / `node-counter` / `node-alert`.

**broken-ref + unknown-field gain a per-node chip + corner badge.** Both analyzers were Issue-panel-only; they now also emit to `graph.node.alert` (corner badge with optional count) and `card.footer.right` (counter chip with value + tooltip). Per-source aggregation: a node with three broken refs lights up ONE chip with `count: 3`, not three overlapping markers. The same model holds for unknown fields (aggregated across the rule's three surfaces: `annotations:` keys, root keys, plugin-namespaced values). Iconography: `pi-times-circle` for broken-ref, `pi-info-circle` for unknown-field. Both unlocked — `sm plugins disable core/<id>` clears both surfaces immediately via the eager-purge contract.

**annotation-stale reshapes to icon-only footer chip.** Drops the `graph.node.alert` corner badge (which duplicated info with broken-ref / unknown-field already living there) and keeps only the `pi-clock` chip in `card.footer.right`. Emit with `value: 0` + the renderer's new `value > 0` guard yields an icon-only chip. The per-face detail (body / frontmatter / both) lives on the tooltip.

**Renderer cleanup (`node-icon` / `node-counter` / `node-alert`).** All three lose the `background: var(--sm-severity-*-bg)` pill. Severity now drives `color` on the glyph (and on the value / count for counter / alert) directly — no tinted wrapper. The chip reads as one chromatic unit without competing with neighbour chrome.

**Implementation**: per analyzer, the evaluate loop pushes issues as before and bumps a per-node count Map; a second loop emits the aggregated contributions. `Math.min(count, 99)` cap honours the slot schema. `replaceAllScanContributions`'s per-tuple sweep already barrels through the eager-purge path on disable / re-extract; the new emitters compose cleanly with the existing sweep semantics.

**Tests**:

- `src/built-in-plugins/analyzers/broken-ref/broken-ref.test.ts` — new file. Covers no-broken, single-broken (no count), multi-broken aggregation (count = N), the 99-cap branch, and the manifest declaration.
- `src/built-in-plugins/analyzers/unknown-field/unknown-field.test.ts` — new file. Covers no-unknown, single-unknown, multi-surface aggregation, manifest declaration.
- `src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts` — updated. Single contribution per stale node (`staleIcon` with `value: 0`); manifest assertion verifies one slot.
- `src/test/view-contributions.test.ts` — the regression case "per-tuple sweep handles nodePaths with slashes" now reflects the current shape of annotation-stale (no longer emits to `graph.node.alert`).

## User-facing

Nodes with broken references or unknown sidecar fields now show a colored chip in the card footer (and a matching badge on the graph view) with a count and tooltip. The stale-sidecar warning becomes a single `pi-clock` icon in the footer — tooltip explains which side drifted.
