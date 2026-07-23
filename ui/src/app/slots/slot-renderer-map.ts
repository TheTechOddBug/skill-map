/**
 * View contribution system, closed catalog of slot ids mapped to
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
import { NodeBadge } from '../renderers/node-badge/node-badge';
import { NodeActionButton } from '../renderers/node-action-button/node-action-button';
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
  /**
   * Path of the node this contribution is rendered for. Threaded by the
   * slot host (`view-contributions-host`) from `node.path`. Action
   * renderers (`NodeActionButton`) need it to dispatch a kernel Action
   * against the right node; every other renderer ignores it.
   */
  nodePath: string;
  /** Per-node payload, already validated at emit time on the kernel side. */
  payload: unknown;
}

/**
 * Slot → renderer component. The slot host instantiates the
 * component dynamically (`NgComponentOutlet` style) per
 * contribution. Standalone Angular components, no NgModule wiring.
 *
 * Each slot has exactly one renderer; payload shape is fixed per
 * slot at the spec layer. Some renderers (NodeCounter) are mounted in
 * multiple slots, they are stateless and accept the same
 * `IRendererInputs` regardless of mount.
 */
export const SLOT_RENDERERS: Record<TSlotId, Type<unknown>> = {
  'card.title.right': NodeIcon,
  'card.subtitle.left': NodeCounter,
  'card.footer.left': NodeCounter,
  'card.footer.right': NodeCounter,
  'graph.node.alert': NodeAlert,
  'inspector.header.badge': NodeBadge,
  'inspector.action.button': NodeActionButton,
  // The five dedicated surface slots are consumed by their OWN
  // components (inspector header chips, tag row, node card echoes) via
  // `surfaceContribution`; the generic host never mounts them. The
  // entries keep the closed Record total (isKnownSlot accepts them) and
  // point at the action renderer as the nominal payload-compatible
  // component.
  'inspector.surface.version': NodeActionButton,
  'inspector.surface.stability': NodeActionButton,
  'inspector.surface.tags': NodeActionButton,
  'inspector.surface.summary': NodeActionButton,
  'inspector.surface.auto-tag': NodeActionButton,
  'inspector.body.panel.breakdown': NodeBreakdown,
  'inspector.body.panel.records': NodeRecords,
  'inspector.body.panel.tree': NodeTree,
  'inspector.body.panel.key-values': NodeKeyValues,
  'inspector.body.panel.link-list': NodeLinkList,
  'inspector.body.panel.markdown': NodeMarkdown,
  'topbar.nav.start': ScopeStat,
};

/** Type guard, narrow an unknown slot string to the closed enum. */
export function isKnownSlot(slot: string): slot is TSlotId {
  return slot in SLOT_RENDERERS;
}
