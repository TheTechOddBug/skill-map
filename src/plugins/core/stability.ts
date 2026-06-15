/**
 * Shared "effective stability" read for the two plugins that speak the
 * lifecycle field: the `core/node-stability` analyzer (surfaces the stage
 * as a chip + issue) and the `core/node-set-stability` action (pre-loads
 * the inspector button's `defaultValue` and writes the field). Single
 * source of truth so the two cannot drift on the recognised enum or the
 * precedence.
 *
 * Precedence: the sidecar `annotations.stability` (canonical, Step 9.6)
 * wins over the legacy frontmatter `metadata.stability` carried by
 * un-migrated `.md` files (mirror of `effectiveStability` in
 * `ui/src/models/node-derived.ts`).
 */

import type { Node } from '../../kernel/types.js';

/**
 * Recognised lifecycle stages, mirror of
 * `spec/schemas/annotations.schema.json#/properties/stability`.
 */
export type TStability = 'experimental' | 'stable' | 'deprecated';

export const STABILITY_VALUES: readonly TStability[] = ['experimental', 'stable', 'deprecated'];

export function isStability(value: unknown): value is TStability {
  return value === 'experimental' || value === 'stable' || value === 'deprecated';
}

/**
 * The node's effective lifecycle stage: sidecar `annotations.stability`
 * first, then legacy frontmatter `metadata.stability`. Returns `null` when
 * neither source carries a recognised value.
 */
export function readEffectiveStability(node: Node): TStability | null {
  const fromAnn = node.sidecar?.annotations?.['stability'];
  if (isStability(fromAnn)) return fromAnn;
  const legacy = readLegacyMetadataStability(node.frontmatter);
  return isStability(legacy) ? legacy : null;
}

function readLegacyMetadataStability(fm: Record<string, unknown> | undefined): unknown {
  if (!fm) return undefined;
  const meta = fm['metadata'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  return (meta as Record<string, unknown>)['stability'];
}
