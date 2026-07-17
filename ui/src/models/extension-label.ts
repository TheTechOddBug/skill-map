/**
 * Short display label for a qualified extension id: the extension
 * segment of the id minus the `node-` naming-convention prefix every
 * per-node built-in carries (user call 2026-07-17: `core/node-redundancy`
 * reads as `redundancy` on a button; the full qualified id stays in the
 * tooltip and the test id). Shared by the inspector's AI-actions
 * launcher labels and the Activity timeline's AI-run rows so the two
 * surfaces can never drift.
 */
export function shortExtensionLabel(id: string): string {
  return (id.split('/').pop() ?? id).replace(/^node-/, '');
}
