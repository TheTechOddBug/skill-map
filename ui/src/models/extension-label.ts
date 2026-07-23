/**
 * Short display label for a qualified extension id: the extension segment
 * of the id with its naming-convention chrome stripped so a button reads
 * as the bare subject (user call 2026-07-17: `core/ai-redundancy-analyzer`
 * reads as `redundancy` on a button; the full qualified id stays in the
 * tooltip and the test id). AI (probabilistic) extensions follow the
 * `ai-<subject>-<kind>` pattern, so both the `ai-` prefix and the
 * `-analyzer` / `-action` suffix come off; the legacy per-node `node-`
 * prefix is stripped too. Shared by the inspector's AI-actions launcher
 * labels and the Activity timeline's AI-run rows so the two surfaces can
 * never drift.
 */
export function shortExtensionLabel(id: string): string {
  return (id.split('/').pop() ?? id)
    .replace(/^(ai|node)-/, '')
    .replace(/-(analyzer|action)$/, '');
}
