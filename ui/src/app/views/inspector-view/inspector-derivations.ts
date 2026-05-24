/**
 * Per-node derivations for the inspector view.
 *
 * Owns the small but chatty set of computeds the template uses to
 * decide which cards / sections render:
 *
 *   - `sidecarRoot`: the full `.sm` root (real or synthesized).
 *   - `hasVendorFrontmatter`: gate for the vendor card chrome.
 *   - `hasPluginContributions`: gate for the plugin contributions section.
 *   - `hasViewContributions`: gate for the inspector body slots card.
 *   - `auditSummary`: collapsed audit section header inline string.
 *
 * Hoisted out of `inspector-view.ts` so the component stays focused on
 * mode handling + child-component wiring + bump dispatch. Mirrors the
 * `inspector-bump-controller` / `inspector-body-state` pattern: a
 * `setupX` factory returns a typed handle the component holds.
 */

import { computed, type Signal } from '@angular/core';

import type { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import type { INodeView, TNodeKind } from '../../../models/node';
import { relativeTime } from '../../../models/node-derived';

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
  texts: typeof INSPECTOR_VIEW_TEXTS;
}

export interface IInspectorDerivationsHandle {
  readonly sidecarRoot: Signal<Record<string, unknown> | null>;
  readonly hasVendorFrontmatter: Signal<boolean>;
  readonly hasPluginContributions: Signal<boolean>;
  readonly hasViewContributions: Signal<boolean>;
  readonly auditSummary: Signal<string>;
}

export function setupInspectorDerivations(
  config: IInspectorDerivationsConfig,
): IInspectorDerivationsHandle {
  const { node: nodeSignal, texts } = config;

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

  const auditSummary = computed<string>(() => {
    const root = sidecarRoot();
    if (!root) return texts.audit.headerEmpty;
    const audit = root['audit'];
    if (typeof audit !== 'object' || audit === null) {
      return texts.audit.headerEmpty;
    }
    const a = audit as Record<string, unknown>;
    const lastBumpedAt =
      typeof a['lastBumpedAt'] === 'string' ? (a['lastBumpedAt'] as string) : null;
    const lastBumpedBy =
      typeof a['lastBumpedBy'] === 'string' ? (a['lastBumpedBy'] as string) : null;
    if (lastBumpedAt === null) return texts.audit.headerEmpty;
    return texts.audit.headerSummary(relativeTime(lastBumpedAt), lastBumpedBy ?? '?');
  });

  return {
    sidecarRoot,
    hasVendorFrontmatter,
    hasPluginContributions,
    hasViewContributions,
    auditSummary,
  };
}
