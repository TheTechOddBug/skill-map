/**
 * Pure helpers for EDITING a sidecar's two dismissal arrays
 * (`spec/schemas/annotations.schema.json`):
 *
 *   - `annotations.suppressions`, probabilistic finding classes keyed by
 *     (extension, type), shared by the CLI verbs (`sm findings dismiss`
 *     / `undismiss`, `cli/commands/findings.ts`) and the BFF
 *     finding-action routes (`server/routes/node-finding-actions.ts`).
 *   - `annotations.issueSuppressions`, deterministic analyzer issues
 *     keyed by (analyzer, value), shared by `sm issues dismiss` /
 *     `undismiss`, the BFF issue-action routes, and the MCP issue
 *     tools.
 *
 * All functions are pure over already-parsed annotation objects; the
 * caller owns the sidecar read (`readSidecarFor`), the gated write
 * (`FilesystemSidecarStore.applyPatch`, which REPLACES arrays wholesale,
 * so the FULL merged / filtered list must be handed over), and the
 * write-through refresh of the `scan_nodes.annotations_json` mirror
 * (`spec/db-schema.md` §state_findings, read-time suppression lens;
 * §scan_issues, emission-time issue suppressions).
 */

/**
 * Existing `annotations.suppressions` entries from a parsed sidecar, kept
 * verbatim (they already validated on their own write). Non-array or
 * absent yields `[]`.
 */
export function existingSuppressions(
  annotations: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const raw = annotations?.['suppressions'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
}

/**
 * Append `entry` to the existing suppressions unless an identical
 * (extension, type) entry already stands (idempotent per
 * `spec/cli-contract.md` §sm findings dismiss: a repeat dismiss is a
 * no-op, never a duplicate). Note is NOT part of the identity, so a second
 * dismiss with a different note does not add a row.
 */
export function mergeSuppression(
  existing: readonly Record<string, unknown>[],
  entry: Record<string, unknown>,
): Record<string, unknown>[] {
  const dup = existing.some(
    (e) =>
      e['extension'] === entry['extension'] &&
      normalizeSuppressionType(e['type']) === normalizeSuppressionType(entry['type']),
  );
  return dup ? [...existing] : [...existing, entry];
}

/** A suppression's `type` normalized for identity comparison (absent === undefined). */
export function normalizeSuppressionType(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The suppression entry a dismiss appends: `{ extension, type?, note? }`.
 * `type` rides when non-empty (finder findings always carry one); `note`
 * rides when the operator supplied one.
 */
export function buildSuppressionEntry(
  extensionId: string,
  type: string,
  note: string | undefined,
): Record<string, unknown> {
  const entry: Record<string, unknown> = { extension: extensionId };
  if (type.length > 0) entry['type'] = type;
  if (note !== undefined && note.length > 0) entry['note'] = note;
  return entry;
}

/**
 * Existing `annotations.issueSuppressions` entries from a parsed
 * sidecar, kept verbatim. Non-array or absent yields `[]`.
 */
export function existingIssueSuppressions(
  annotations: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const raw = annotations?.['issueSuppressions'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
}

/**
 * Append `entry` to the existing issue suppressions unless an
 * equivalent (analyzer, value) entry already stands (idempotent per
 * `spec/cli-contract.md` §sm issues dismiss). Analyzer identity accepts
 * both spellings in both directions (a stored `reference-broken` and an
 * incoming `core/reference-broken` are the same entry); `value` is
 * strict and case-sensitive; `note` is not part of the identity.
 */
export function mergeIssueSuppression(
  existing: readonly Record<string, unknown>[],
  entry: Record<string, unknown>,
): Record<string, unknown>[] {
  const dup = existing.some(
    (e) =>
      issueSuppressionAnalyzersEquivalent(e['analyzer'], entry['analyzer']) &&
      e['value'] === entry['value'],
  );
  return dup ? [...existing] : [...existing, entry];
}

/**
 * Remove the (analyzer, value) entry, same identity rules as the merge.
 * Returns the surviving list plus the first entry taken out (`null`
 * when nothing matched), so callers can echo what was removed
 * (`sm issues undismiss --json`, the BFF 409 branch).
 */
export function removeIssueSuppression(
  existing: readonly Record<string, unknown>[],
  analyzer: string,
  value: string,
): { remaining: Record<string, unknown>[]; removed: Record<string, unknown> | null } {
  const remaining: Record<string, unknown>[] = [];
  let removed: Record<string, unknown> | null = null;
  for (const e of existing) {
    const matches =
      issueSuppressionAnalyzersEquivalent(e['analyzer'], analyzer) && e['value'] === value;
    if (matches && removed === null) {
      removed = e;
      continue;
    }
    remaining.push(e);
  }
  return { remaining, removed };
}

/**
 * Analyzer identity for issue-suppression edits: verbatim equality, or
 * a bare short id matching the other side's suffix after `/` (either
 * direction). Two DIFFERENT qualified ids are never equivalent even
 * with the same suffix (`core/x` vs `other/x`), mirroring
 * `matchesQualifiedExtensionFilter`'s grammar.
 */
export function issueSuppressionAnalyzersEquivalent(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a === b) return true;
  const aSlash = a.indexOf('/');
  const bSlash = b.indexOf('/');
  if (aSlash < 0 && bSlash >= 0) return b.slice(bSlash + 1) === a;
  if (bSlash < 0 && aSlash >= 0) return a.slice(aSlash + 1) === b;
  return false;
}

/**
 * The entry an issue dismiss appends: `{ analyzer, value, note? }`.
 * `analyzer` and `value` land verbatim (the caller decides qualified vs
 * short; matching accepts both); `note` rides when the operator
 * supplied one.
 */
export function buildIssueSuppressionEntry(
  analyzer: string,
  value: string,
  note: string | undefined,
): Record<string, unknown> {
  const entry: Record<string, unknown> = { analyzer, value };
  if (note !== undefined && note.length > 0) entry['note'] = note;
  return entry;
}
