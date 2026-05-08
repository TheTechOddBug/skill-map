/**
 * Phase 4 / View contribution system — closed catalog of contract IDs
 * mapped to:
 *   - the renderer Angular component for that contract;
 *   - the slot(s) the contract surfaces in.
 *
 * Mirror of `spec/schemas/view-contracts.schema.json#/$defs/ContractName`
 * for the closed enum; the slot mapping is informative on the spec side
 * (per `view-contracts.md`) and authoritative here (per ROADMAP §UI
 * contribution system → "Slots are UI-only"). The plugin author NEVER
 * sees this file — they pick by `contract` name; the kernel routes,
 * the UI dispatches.
 *
 * Adding a contract requires the spec/kernel/UI/scaffolder round-trip
 * documented in `ROADMAP.md`; the renderer component lands here
 * alongside the spec change.
 */

import type { Type } from '@angular/core';

import type { TSlotId } from '../slots/slot-config';
import { PerNodeBreakdown } from '../renderers/per-node-breakdown/per-node-breakdown';
import { PerNodeCounter } from '../renderers/per-node-counter/per-node-counter';
import { PerNodeKeyValues } from '../renderers/per-node-key-values/per-node-key-values';
import { PerNodeLinkList } from '../renderers/per-node-link-list/per-node-link-list';
import { PerNodeRecords } from '../renderers/per-node-records/per-node-records';
import { PerNodeSummary } from '../renderers/per-node-summary/per-node-summary';
import { PerNodeTag } from '../renderers/per-node-tag/per-node-tag';
import { PerNodeTree } from '../renderers/per-node-tree/per-node-tree';
import { NodeMarker } from '../renderers/node-marker/node-marker';
import { ScopeSummary } from '../renderers/scope-summary/scope-summary';

/**
 * Closed enum of contract names. Mirrors
 * `view-contracts.schema.json#/$defs/ContractName`. Kept in lock-step
 * with the spec catalog by the catalog-version contract
 * (`AGENTS.md` line 41 — "Plugins are scaffolded, not hand-written").
 */
export type TContractId =
  | 'per-node-counter'
  | 'per-node-tag'
  | 'per-node-breakdown'
  | 'per-node-records'
  | 'per-node-tree'
  | 'per-node-key-values'
  | 'per-node-link-list'
  | 'per-node-summary'
  | 'node-marker'
  | 'scope-summary';

/** Inputs every renderer component receives. */
export interface IRendererInputs {
  pluginId: string;
  extensionId: string;
  contributionId: string;
  /** Manifest-declared label/icon/etc. from the contributions registry. */
  label?: string;
  tooltip?: string;
  icon?: string;
  emptyText?: string;
  /** Per-node payload, already validated at emit time on the kernel side. */
  payload: unknown;
}

/**
 * Contract → renderer component. The slot host instantiates the
 * component dynamically (`createComponent(...)` style) per
 * contribution. Standalone Angular components — no NgModule wiring.
 */
export const CONTRACT_RENDERERS: Record<TContractId, Type<unknown>> = {
  'per-node-counter': PerNodeCounter,
  'per-node-tag': PerNodeTag,
  'per-node-breakdown': PerNodeBreakdown,
  'per-node-records': PerNodeRecords,
  'per-node-tree': PerNodeTree,
  'per-node-key-values': PerNodeKeyValues,
  'per-node-link-list': PerNodeLinkList,
  'per-node-summary': PerNodeSummary,
  'node-marker': NodeMarker,
  'scope-summary': ScopeSummary,
};

/**
 * Contract → slot(s). A contract may surface in multiple slots
 * (e.g. `per-node-counter` renders both as a card chip and as an
 * inspector header badge); the slot host filters by the slot it was
 * mounted in to pick which contributions to render.
 */
export const CONTRACT_SLOTS: Record<TContractId, TSlotId[]> = {
  'per-node-counter': ['card.chip', 'inspector.header.badge'],
  'per-node-tag': ['card.chip', 'inspector.header.badge'],
  'per-node-breakdown': ['inspector.body'],
  'per-node-records': ['inspector.body'],
  'per-node-tree': ['inspector.body'],
  'per-node-key-values': ['inspector.body'],
  'per-node-link-list': ['inspector.body'],
  'per-node-summary': ['inspector.body'],
  'node-marker': ['graph.node.marker'],
  'scope-summary': ['topbar.indicator'],
};

/** Type guard — narrow an unknown contract string to the closed enum. */
export function isKnownContract(contract: string): contract is TContractId {
  return contract in CONTRACT_RENDERERS;
}
