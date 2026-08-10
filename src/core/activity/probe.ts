/**
 * The wiring-self-test probe payload, shared by the two ends that must
 * agree on it (see `spec/provider-activity.md` §Wiring self-test): the
 * CLI verb that mints one and the BFF ingest that short-circuits it.
 *
 * Lives in `core/` rather than next to the server's nonce ring because
 * `core/` may not import from `server/`, and the marker is a contract
 * both sides read, not server state.
 */

/**
 * The raw-event field that marks a payload as a self-test probe rather
 * than a provider event. Double-underscore camelCase cannot collide
 * with a vendor hook payload (every supported runtime uses snake_case
 * or lowercase dotted keys), so the discriminator needs no
 * provider-specific knowledge.
 */
export const PROBE_MARKER = '__skillMapProbe';

/** The exact stdin bytes the self-test hands the bridge. */
export function buildProbePayload(nonce: string): string {
  return JSON.stringify({ [PROBE_MARKER]: nonce });
}

/**
 * The probe nonce carried by `event`, or `null` when the payload is an
 * ordinary provider event. Total over arbitrary input: the ingest body
 * is external, so anything that is not a non-empty string reads as
 * "not a probe" and falls through to normal mapping.
 */
export function probeNonceOf(event: Record<string, unknown>): string | null {
  const nonce = event[PROBE_MARKER];
  return typeof nonce === 'string' && nonce.length > 0 ? nonce : null;
}
