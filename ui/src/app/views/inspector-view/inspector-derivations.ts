/**
 * Per-node derivations for the inspector view.
 *
 * Owns the small but chatty set of computeds the template uses to
 * decide which cards / sections render:
 *
 *   - `sidecarRoot`: the full `.sm` root (real or synthesized).
 *   - `hasVendorFrontmatter`: gate for the vendor card chrome.
 *   - `hasConnections`: gate for the connections section.
 *   - `hasPluginContributions`: gate for the plugin contributions section.
 *   - `hasViewContributions`: gate for the inspector body slots card.
 *   - `hasMetadata`: gate for the metadata (audit + debug) section.
 *
 * Hoisted out of `inspector-view.ts` so the component stays focused on
 * mode handling + child-component wiring + bump dispatch. Mirrors the
 * `inspector-bump-controller` / `inspector-body-state` pattern: a
 * `setupX` factory returns a typed handle the component holds.
 */

import { computed, type Signal } from '@angular/core';

import type { INodeView, TNodeKind } from '../../../models/node';

/**
 * Six inspector-body sub-slots the host mounts. Filtering the node's
 * contributions by this set keeps the `hasViewContributions` gate in
 * sync with the template; if a slot is removed or renamed, the gate
 * stays correct because both lists live here.
 */
export const INSPECTOR_BODY_SLOTS: ReadonlySet<string> = new Set([
  'inspector.body.panel.breakdown',
  'inspector.body.panel.records',
  'inspector.body.panel.tree',
  'inspector.body.panel.key-values',
  'inspector.body.panel.link-list',
  'inspector.body.panel.markdown',
]);

const RESERVED_SIDECAR_KEYS: ReadonlySet<string> = new Set([
  'identity',
  'annotations',
  'settings',
  'audit',
]);

const VENDOR_KINDS: ReadonlySet<TNodeKind> = new Set<TNodeKind>([
  'agent',
  'skill',
  'command',
]);

export interface IInspectorDerivationsConfig {
  node: Signal<INodeView | null>;
}

export interface IInspectorDerivationsHandle {
  readonly sidecarRoot: Signal<Record<string, unknown> | null>;
  readonly hasVendorFrontmatter: Signal<boolean>;
  readonly hasConnections: Signal<boolean>;
  readonly hasPluginContributions: Signal<boolean>;
  readonly hasViewContributions: Signal<boolean>;
  readonly hasMetadata: Signal<boolean>;
}

export function setupInspectorDerivations(
  config: IInspectorDerivationsConfig,
): IInspectorDerivationsHandle {
  const { node: nodeSignal } = config;

  const sidecarRoot = computed<Record<string, unknown> | null>(() => {
    const overlay = nodeSignal()?.sidecar;
    if (!overlay || !overlay.present) return null;
    if (overlay.root) return overlay.root;
    // Synthesize the minimum root so the audit / plugin panels render
    // their empty states instead of throwing on a missing input.
    const synthetic: Record<string, unknown> = {};
    if (overlay.annotations) synthetic['annotations'] = overlay.annotations;
    return synthetic;
  });

  const hasVendorFrontmatter = computed<boolean>(() => {
    const k = nodeSignal()?.kind;
    return k !== undefined && VENDOR_KINDS.has(k);
  });

  // The connections panel surfaces outgoing/incoming links plus external
  // references. The node carries the three counters projected from the
  // scan, so we gate the (lazy) panel on them without instantiating it:
  // when all three are zero (or absent, treated as zero per the operator
  // decision), there is nothing to connect and the section is hidden.
  const hasConnections = computed<boolean>(() => {
    const n = nodeSignal();
    if (!n) return false;
    const total =
      (n.linksOutCount ?? 0) + (n.linksInCount ?? 0) + (n.externalRefsCount ?? 0);
    return total > 0;
  });

  const hasPluginContributions = computed<boolean>(() => {
    const root = sidecarRoot();
    if (!root) return false;
    for (const key of Object.keys(root)) {
      if (!RESERVED_SIDECAR_KEYS.has(key)) return true;
    }
    return false;
  });

  const hasViewContributions = computed<boolean>(() => {
    const contributions = nodeSignal()?.contributions ?? [];
    for (const c of contributions) {
      if (INSPECTOR_BODY_SLOTS.has(c.slot)) return true;
    }
    return false;
  });

  // The metadata section hosts the audit panel (sidecar `audit:` block)
  // and the debug panel. Both read off the `.sm` root, so without a
  // sidecar the section has nothing meaningful to show and is hidden.
  const hasMetadata = computed<boolean>(() => sidecarRoot() !== null);

  return {
    sidecarRoot,
    hasVendorFrontmatter,
    hasConnections,
    hasPluginContributions,
    hasViewContributions,
    hasMetadata,
  };
}
