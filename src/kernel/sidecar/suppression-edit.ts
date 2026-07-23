/**
 * Pure helpers for EDITING a sidecar's `annotations.suppressions` array
 * (`spec/schemas/annotations.schema.json`), shared by the CLI verbs
 * (`sm findings dismiss` / `undismiss`, `cli/commands/findings.ts`) and
 * the BFF finding-action routes (`server/routes/node-finding-actions.ts`).
 *
 * All functions are pure over already-parsed annotation objects; the
 * caller owns the sidecar read (`readSidecarFor`), the gated write
 * (`FilesystemSidecarStore.applyPatch`, which REPLACES arrays wholesale,
 * so the FULL merged / filtered list must be handed over), and the
 * write-through refresh of the `scan_nodes.annotations_json` mirror
 * (`spec/db-schema.md` §state_findings, read-time suppression lens).
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
