/**
 * `buildContributionsRegistry(kernel)` — assemble the catalog of view
 * contributions the BFF embeds in every payload-bearing envelope
 * (parallel to `buildKindRegistry` for the kindRegistry surface).
 *
 * The registry mirrors
 * `spec/schemas/api/rest-envelope.schema.json#/properties/contributionsRegistry`:
 * qualified id (`<pluginId>/<extensionId>/<contributionId>`) → registered
 * shape including `pluginId` / `extensionId` / `contributionId` /
 * `slot` plus optional manifest-declared presentation hints (`label`,
 * `tooltip`, `icon`, `emptyText`, `emitWhenEmpty`).
 *
 * The plugin author picks one slot from the closed catalog
 * published in `spec/schemas/view-slots.schema.json`. The slot fixes
 * both the renderer and the payload shape — the UI mounts a host per
 * slot and renders whatever the kernel emits for it.
 *
 * Deterministic: order = `kernel.getRegisteredViewContributions()`
 * iteration order, which itself comes from the plugin runtime
 * `collectViewContributions` linear walk. No I/O, no kernel
 * side-effects.
 */

import type { Kernel, IRegisteredViewContribution } from '../kernel/index.js';

export type IContributionsRegistry = Record<string, IContributionsRegistryEntry>;

export interface IContributionsRegistryEntry {
  pluginId: string;
  extensionId: string;
  contributionId: string;
  slot: string;
  label?: string;
  tooltip?: string;
  icon?: string;
  emptyText?: string;
  emitWhenEmpty: boolean;
  /**
   * Optional ordering hint (default 100 when omitted). Slots whose
   * `order` is `'priority'` sort contributions ASC by this value with
   * alphabetical tie-break by qualified id. Mirror of
   * `IRegisteredViewContribution.priority` — propagated to the UI so
   * the slot host can apply the manifest-declared order without a
   * second round-trip.
   */
  priority?: number;
}

export function buildContributionsRegistry(kernel: Kernel): IContributionsRegistry {
  const registry: IContributionsRegistry = {};
  for (const c of kernel.getRegisteredViewContributions()) {
    registry[qualifiedId(c)] = entryFromRegistered(c);
  }
  return registry;
}

function qualifiedId(c: IRegisteredViewContribution): string {
  return `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
}

function entryFromRegistered(c: IRegisteredViewContribution): IContributionsRegistryEntry {
  const entry: IContributionsRegistryEntry = {
    pluginId: c.pluginId,
    extensionId: c.extensionId,
    contributionId: c.contributionId,
    slot: c.slot,
    emitWhenEmpty: c.emitWhenEmpty,
  };
  if (c.label !== undefined) entry.label = c.label;
  if (c.tooltip !== undefined) entry.tooltip = c.tooltip;
  if (c.icon !== undefined) entry.icon = c.icon;
  if (c.emptyText !== undefined) entry.emptyText = c.emptyText;
  if (c.priority !== undefined) entry.priority = c.priority;
  return entry;
}
