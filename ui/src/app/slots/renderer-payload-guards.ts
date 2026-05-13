/**
 * Defensive narrowing helpers for slot renderer payloads.
 *
 * The kernel validates payload shapes against an AJV schema before
 * persisting them, but the UI's trust boundary on
 * `IContributionApi.payload` is wider: anything that survived storage
 * could re-arrive as `unknown` after a schema rename, a stale row, or
 * a bug in the validator. These guards let each renderer drop to its
 * `emptyText` branch on the malformed-but-storable cases instead of
 * rendering `undefined`s or `[object Object]`.
 *
 * Cheap by design: each guard is a single shape check, not a full
 * structural validator. The kernel still owns the contract; this
 * file only protects the rendering path from total surprises.
 */

export function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isArrayField(value: unknown, key: string): boolean {
  return isObjectPayload(value) && Array.isArray(value[key]);
}

export function isStringField(value: unknown, key: string): boolean {
  return isObjectPayload(value) && typeof value[key] === 'string';
}
