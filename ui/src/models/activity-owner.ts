/**
 * Live-activity owner keys (`spec/provider-activity.md`) are sessionized
 * ids like `main:6cfe5636-2e56-4271-91a6-87fc3d4355be` or an opaque
 * agent id. The full string is precise but far too long for a dense
 * activity row, it squishes the neighbouring content (e.g. the tool
 * `detail`). This trims it to a scannable form for display; callers
 * keep the full string for the title / tooltip.
 *
 * Rule: keep any prefix before the FIRST `:` verbatim (e.g. `main`) and
 * truncate the id part to `OWNER_ID_MAX` chars (`main:6cfe5636`). With
 * no `:` prefix, truncate the whole string to the first `OWNER_ID_MAX`
 * chars. Empty input returns empty. No ellipsis, the full value lives
 * in the tooltip.
 */
export const OWNER_ID_MAX = 8;

export function shortenOwner(owner: string): string {
  if (owner.length === 0) return owner;
  const sep = owner.indexOf(':');
  if (sep === -1) return owner.slice(0, OWNER_ID_MAX);
  const prefix = owner.slice(0, sep);
  const id = owner.slice(sep + 1);
  return `${prefix}:${id.slice(0, OWNER_ID_MAX)}`;
}
