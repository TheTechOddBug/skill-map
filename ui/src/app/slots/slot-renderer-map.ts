/**
 * View contribution system — closed catalog of slot ids mapped to
 * the renderer Angular component for that slot.
 *
 * Mirror of `spec/schemas/view-slots.schema.json#/$defs/SlotName`.
 * Each slot is monomorphic: 1 slot → 1 renderer → 1 payload shape.
 * The plugin author picks a `slot` directly in the manifest; the
 * kernel validates the payload against the slot's shape; the UI
 * mounts one host per slot in the templates and dispatches to the
 * matching renderer per contribution.
 *
 * Adding a slot requires the spec/kernel/UI/scaffolder round-trip
 * documented in `ROADMAP.md`; the renderer component lands here
 * alongside the spec change.
 */

import type { Type } from '@angular/core';

import type { TSlotId } from './slot-config';
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
 * Slot → renderer component. The slot host instantiates the
 * component dynamically (`NgComponentOutlet` style) per
 * contribution. Standalone Angular components — no NgModule wiring.
 *
 * Each slot has exactly one renderer; payload shape is fixed per
 * slot at the spec layer. Some renderers (NodeCounter, NodeTag) are
 * mounted in multiple slots — they are stateless and accept the
 * same `IRendererInputs` regardless of mount.
 */
export const SLOT_RENDERERS: Record<TSlotId, Type<unknown>> = {
  'card.title.right': NodeIcon,
  'card.subtitle.left': NodeCounter,
  'card.footer.left': NodeCounter,
  'card.footer.right': NodeCounter,
  'graph.node.alert': NodeAlert,
  'inspector.header.badge.counter': NodeCounter,
  'inspector.header.badge.tag': NodeTag,
  'inspector.body.panel.breakdown': NodeBreakdown,
  'inspector.body.panel.records': NodeRecords,
  'inspector.body.panel.tree': NodeTree,
  'inspector.body.panel.key-values': NodeKeyValues,
  'inspector.body.panel.link-list': NodeLinkList,
  'inspector.body.panel.markdown': NodeMarkdown,
  'topbar.actions.indicator': ScopeStat,
};

/** Type guard — narrow an unknown slot string to the closed enum. */
export function isKnownSlot(slot: string): slot is TSlotId {
  return slot in SLOT_RENDERERS;
}
