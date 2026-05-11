/**
 * Stability extractor. Surfaces the node's lifecycle stage
 * (`stability: experimental | deprecated`) as an icon-only chip on
 * `card.footer.right`. Reads the sidecar `annotations.stability` first
 * (Decision #125 / Step 9.6 canonical home), then falls back to legacy
 * frontmatter `metadata.stability` for un-migrated `.md` files.
 *
 * Per-node, frontmatter-scope, no link emissions — the only output is
 * a single view contribution (or zero, when stability is absent or
 * `stable`). The two stability values that produce a chip
 * (`experimental` / `deprecated`) are mutually exclusive on a given
 * node, so at most one contribution fires per extract pass.
 *
 * Chip shape mirrors `annotation-stale`'s footer-right chip: `value: 0`
 * + `emitWhenEmpty: false` yields an icon-only chip via NodeCounter's
 * `value > 0` guard. No numeric badge — the icon alone (bolt / ban) +
 * tooltip carry the meaning, and the host's `.sm-gnode--deprecated`
 * fade survives independently because the card component still reads
 * `effectiveStability(node)` directly for that host binding.
 *
 * Replaces the hardcoded experimental SVG / `pi-ban` icons that used
 * to live in `node-card.html`'s `.sm-gnode__footer-end` wrapper. The
 * injection icon that shared the same wrapper was dead code (the stub
 * summarizer hardcoded `injectionDetected: false`) and was removed
 * along with the migration; a real safety plugin can be built once
 * the Step 9+ summarizer lands with actual data.
 */

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';

const ID = 'stability';

const EXPERIMENTAL_TOOLTIP = 'Experimental — API may change';
const DEPRECATED_TOOLTIP = 'Deprecated — avoid in new code';

export const stabilityExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Shows an icon chip on the card footer when the node is marked `stability: experimental` or `stability: deprecated` (read from the sidecar `annotations:` block, with legacy `metadata:` frontmatter as fallback).',
  stability: 'stable',
  emitsLinkKinds: [],
  defaultConfidence: 'high',
  scope: 'frontmatter',

  viewContributions: {
    experimental: {
      slot: 'card.footer.right',
      icon: 'pi-bolt',
      label: 'experimental',
      emitWhenEmpty: false,
    },
    deprecated: {
      slot: 'card.footer.right',
      icon: 'pi-ban',
      label: 'deprecated',
      emitWhenEmpty: false,
    },
  },

  extract(ctx: IExtractorContext): void {
    const stability = readStability(ctx);
    if (stability === 'experimental') {
      ctx.emitContribution('experimental', {
        value: 0,
        tooltip: EXPERIMENTAL_TOOLTIP,
      });
    } else if (stability === 'deprecated') {
      ctx.emitContribution('deprecated', {
        value: 0,
        tooltip: DEPRECATED_TOOLTIP,
        severity: 'warn',
      });
    }
  },
};

/**
 * Sidecar `annotations.stability` wins over legacy frontmatter
 * `metadata.stability` (mirror of `effectiveStability` in
 * `ui/src/models/node-derived.ts`). Returns `null` when neither source
 * carries a recognised value.
 */
function readStability(ctx: IExtractorContext): 'experimental' | 'deprecated' | 'stable' | null {
  const ann = ctx.node.sidecar?.annotations;
  const fromAnn = ann?.['stability'];
  if (isStability(fromAnn)) return fromAnn;
  const meta = ctx.frontmatter['metadata'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const legacy = (meta as Record<string, unknown>)['stability'];
    if (isStability(legacy)) return legacy;
  }
  return null;
}

function isStability(value: unknown): value is 'experimental' | 'deprecated' | 'stable' {
  return value === 'experimental' || value === 'deprecated' || value === 'stable';
}
