/**
 * Pull declared view contributions off a loaded extension instance and
 * append one `IRegisteredViewContribution` per entry to the supplied
 * accumulator. Single source of truth shared between two boot-time
 * paths:
 *
 *   - `core/runtime/plugin-runtime.ts` (user plugins) — extension
 *     instances arrive as `unknown` from a dynamic `await import()`, so
 *     the helper inspects fields via duck typing. The loader has
 *     already validated the manifest against
 *     `view-slots.schema.json#/$defs/IViewContribution`, so unknown
 *     slots never reach this collector; the typeof guards are
 *     defence-in-depth.
 *   - `server/index.ts` (built-ins) — extensions arrive shaped as
 *     `TBuiltInExtension` (each kind extends `IExtensionBase`), so
 *     `instance.viewContributions` is already typed as
 *     `Record<string, IViewContribution> | undefined`. The duck typing
 *     is redundant on this path but the projection logic is identical,
 *     so reusing the same helper cuts the catalog's exposure to
 *     drift-by-divergence.
 *
 * Defaults (`emitWhenEmpty: false`) are filled in so consumers see a
 * fully-resolved shape. Caller supplies `pluginId` and `extensionId`
 * because the canonical source differs by path: user plugins inject
 * `pluginId` from `plugin.json#/id`; built-ins carry it on the
 * extension itself.
 *
 * `excludeQualifiedIds` lets the built-ins path skip contributions
 * already harvested via the user-plugin route (a built-in dev override
 * scenario), avoiding duplicate registry rows for the same qualified
 * id.
 */

import type { IRegisteredViewContribution, IViewContribution, TSlotName } from '../types/view-catalog.js';

export interface ICollectViewContributionsOptions {
  excludeQualifiedIds?: ReadonlySet<string>;
}

// Complexity counts the typeof guard chain on each contribution's
// optional fields (label, tooltip, icon, emptyText, emitWhenEmpty,
// priority). The guards are defence-in-depth: the loader validates the
// manifest against `view-slots.schema.json` before this collector ever
// runs, so an invalid shape never reaches here in practice. Splitting
// the per-field hydration into a helper would scatter the projection
// without making the algorithm clearer.
// eslint-disable-next-line complexity
export function collectViewContributions(
  pluginId: string,
  extensionId: string,
  instance: unknown,
  out: IRegisteredViewContribution[],
  options: ICollectViewContributionsOptions = {},
): void {
  if (typeof instance !== 'object' || instance === null) return;
  const raw = (instance as Record<string, unknown>)['viewContributions'];
  if (typeof raw !== 'object' || raw === null) return;
  const exclude = options.excludeQualifiedIds;
  for (const [contributionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Partial<IViewContribution>;
    if (typeof entry.slot !== 'string') continue;
    if (exclude !== undefined) {
      const qualified = `${pluginId}/${extensionId}/${contributionId}`;
      if (exclude.has(qualified)) continue;
    }
    out.push({
      pluginId,
      extensionId,
      contributionId,
      slot: entry.slot as TSlotName,
      ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
      ...(typeof entry.tooltip === 'string' ? { tooltip: entry.tooltip } : {}),
      ...(typeof entry.icon === 'string' ? { icon: entry.icon } : {}),
      ...(typeof entry.emptyText === 'string' ? { emptyText: entry.emptyText } : {}),
      ...(typeof entry.priority === 'number' ? { priority: entry.priority } : {}),
      emitWhenEmpty: entry.emitWhenEmpty === true,
    });
  }
}
