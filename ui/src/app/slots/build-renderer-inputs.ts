/**
 * Shared projection from a persisted view contribution + its registry
 * entry to the `IRendererInputs` a slot renderer consumes.
 *
 * Extracted from `view-contributions-host` so the per-plugin inspector
 * grouping (`inspector-plugin-sections`) reuses the exact same payload
 * shaping: the manifest-declared `label` / `tooltip` / `icon` /
 * `emptyText` come from the registry entry, and `severity` is stripped
 * from the payload for slots that opted out (`respectSeverity: false`).
 *
 * Pure function (no DI): the caller looks the registry entry up and
 * passes it in, so this stays testable in isolation.
 */

import { SLOT_REGISTRY, type TSlotId } from './slot-config';
import type { IRendererInputs } from './slot-renderer-map';
import type { IContributionApi, IContributionsRegistryEntryApi } from '../../models/api';

export function buildRendererInputs(
  c: IContributionApi,
  slot: TSlotId,
  nodePath: string,
  reg: IContributionsRegistryEntryApi | undefined,
): IRendererInputs {
  const respectSeverity = SLOT_REGISTRY[slot].respectSeverity !== false;
  let payload = c.payload;
  if (!respectSeverity && typeof payload === 'object' && payload !== null && 'severity' in payload) {
    const { severity: _drop, ...rest } = payload as Record<string, unknown>;
    payload = rest;
  }
  const inputs: IRendererInputs = {
    pluginId: c.pluginId,
    extensionId: c.extensionId,
    contributionId: c.contributionId,
    nodePath,
    payload,
  };
  if (reg?.label) inputs.label = reg.label;
  if (reg?.tooltip) inputs.tooltip = reg.tooltip;
  if (reg?.icon) inputs.icon = reg.icon;
  if (reg?.emptyText) inputs.emptyText = reg.emptyText;
  return inputs;
}
