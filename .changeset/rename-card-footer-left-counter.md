---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Rename the view slot `card.footer.left.counter` to `card.footer.left`.

After the `card.footer.left.tag` sub-slot was dropped (see prior CHANGELOGs), the counter became the only shape on the left footer of the card. The `.counter` suffix was a leftover of the dual-shape sub-slot scheme — the slot is now symmetrical with `card.footer.right` and consistent with the bare-base names used for `card.title.right` and `card.subtitle.left`.

**Wire format (breaking)**

- The `SlotName` enum in `spec/schemas/view-slots.schema.json` lists `card.footer.left` instead of `card.footer.left.counter`. The `$defs.payloads` map and the `IViewContribution.allOf` icon-required guard are updated to match.
- Plugin manifests that declare `viewContributions[*].slot: 'card.footer.left.counter'` need to update the literal to `'card.footer.left'`. Greenfield rename: no compatibility shim, no `catalogCompat` bump (no released external plugin uses this slot).

**Kernel + built-ins (breaking)**

- TypeScript: `TSlotName` in `src/kernel/types/view-catalog.ts` and the `KNOWN_SLOTS` set in `src/kernel/adapters/schema-validators.ts` now use `'card.footer.left'`. The `unknown-slot` analyzer's catalog mirror is updated.
- Built-in extractors: `at-directive`, `markdown-link`, and `slash` now declare `slot: 'card.footer.left'` in their `viewContributions.count` entry.
- Scaffolder: the `VIEW_SLOTS_CATALOG` array and the `plugins create` stub default in `src/cli/commands/plugins.ts` emit `card.footer.left`. Help / tip text updated.

**UI**

- `ui/src/app/slots/slot-config.ts` — `TSlotId` and `SLOT_REGISTRY` rekeyed.
- `ui/src/app/slots/slot-renderer-map.ts` — renderer mapping rekeyed.
- `ui/src/app/components/node-card/node-card.html` — debug-slot data attribute and host slot literal renamed.
- `ui/src/app/debug-slots.css` — debug-outline selector renamed.

**Migration**

User plugins (when any exist outside this repo) update the literal in their `plugin.json#/viewContributions[*]/slot` field. The doctor verb (`sm plugins doctor`) flags the old name as `unknown-slot` after upgrading.

## User-facing

The view slot `card.footer.left.counter` was renamed to `card.footer.left` — symmetrical with `card.footer.right`. Plugin authors using the old literal in `plugin.json` need to update it; the scaffolder emits the new name automatically.
