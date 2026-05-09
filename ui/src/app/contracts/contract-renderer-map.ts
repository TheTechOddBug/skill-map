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
import { NodeBreakdown } from '../renderers/node-breakdown/node-breakdown';
import { NodeCounter } from '../renderers/node-counter/node-counter';
import { NodeKeyValues } from '../renderers/node-key-values/node-key-values';
import { NodeLinkList } from '../renderers/node-link-list/node-link-list';
import { NodeRecords } from '../renderers/node-records/node-records';
import { NodeMarkdown } from '../renderers/node-markdown/node-markdown';
import { NodeTag } from '../renderers/node-tag/node-tag';
import { NodeTree } from '../renderers/node-tree/node-tree';
import { NodeAlert } from '../renderers/node-alert/node-alert';
import { NodeIcon } from '../renderers/node-icon/node-icon';
import { ScopeStat } from '../renderers/scope-stat/scope-stat';

/**
 * Closed enum of contract names. Mirrors
 * `view-contracts.schema.json#/$defs/ContractName`. Kept in lock-step
 * with the spec catalog by the catalog-version contract
 * (`AGENTS.md` line 41 — "Plugins are scaffolded, not hand-written").
 */
export type TContractId =
  | 'node-counter'
  | 'node-tag'
  | 'node-breakdown'
  | 'node-records'
  | 'node-tree'
  | 'node-key-values'
  | 'node-link-list'
  | 'node-markdown'
  | 'node-alert'
  | 'node-icon'
  | 'scope-stat';

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
  'node-counter': NodeCounter,
  'node-tag': NodeTag,
  'node-breakdown': NodeBreakdown,
  'node-records': NodeRecords,
  'node-tree': NodeTree,
  'node-key-values': NodeKeyValues,
  'node-link-list': NodeLinkList,
  'node-markdown': NodeMarkdown,
  'node-alert': NodeAlert,
  'node-icon': NodeIcon,
  'scope-stat': ScopeStat,
};

/**
 * Contract → slot(s). A contract may surface in multiple slots
 * (e.g. `node-counter` renders both as a card chip and as an
 * inspector header badge); the slot host filters by the slot it was
 * mounted in to pick which contributions to render.
 */
export const CONTRACT_SLOTS: Record<TContractId, TSlotId[]> = {
  'node-counter': ['card.footer.left', 'card.footer.right', 'card.subtitle.left', 'inspector.header.badge'],
  'node-tag': ['inspector.header.badge'],
  'node-breakdown': ['inspector.body.panel'],
  'node-records': ['inspector.body.panel'],
  'node-tree': ['inspector.body.panel'],
  'node-key-values': ['inspector.body.panel'],
  'node-link-list': ['inspector.body.panel'],
  'node-markdown': ['inspector.body.panel'],
  'node-alert': ['graph.node.alert'],
  'node-icon': ['card.title.right'],
  'scope-stat': ['topbar.actions.indicator'],
};

/** Type guard — narrow an unknown contract string to the closed enum. */
export function isKnownContract(contract: string): contract is TContractId {
  return contract in CONTRACT_RENDERERS;
}
