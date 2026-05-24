/**
 * `stability` analyzer. Reads the lifecycle stage of each node
 * (`stability: experimental | deprecated`) from the sidecar
 * `annotations.stability` first (Decision #125 / Step 9.6 canonical
 * home), then falls back to legacy frontmatter `metadata.stability`
 * for un-migrated `.md` files. Surfaces two parallel signals:
 *
 *   - **Issue**, `deprecated → warn`, `experimental → info`, so
 *     lifecycle state shows up in `sm check` and the inspector's
 *     issues panel.
 *   - **View contribution**, an icon-only chip on `card.footer.right`
 *     (`fa-flask` for experimental, `pi-ban` for deprecated) so the
 *     operator spots the state visually without opening the panel.
 *
 * Moved from `extractors/` to `analyzers/`: this code never produced
 * structural data (no links, no derived fields), it interprets an
 * existing field, which is the analyzer pattern. Sits next to the
 * other `card.footer.right` analyzers (`annotation-stale`,
 * `unknown-field`, `broken-ref`). The plugin id stays `core/stability`
 * only the `kind` flips from `extractor` to `analyzer`.
 *
 * The two stability values that produce a chip (`experimental` /
 * `deprecated`) are mutually exclusive on a given node, so at most
 * one contribution and one issue fire per node. The
 * `.sm-gnode--deprecated` host fade in the card component is
 * independent, it reads `effectiveStability(node)` directly.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'stability';

const EXPERIMENTAL_TOOLTIP = 'Experimental: API may change';
const DEPRECATED_TOOLTIP = 'Deprecated: avoid in new code';

export const stabilityAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Reports a node\'s stability stage (`experimental`, `deprecated`) on the card.',
  mode: 'deterministic',

  ui: {
    experimental: {
      slot: 'card.footer.right',
      icon: 'fa-solid fa-flask',
      label: 'experimental',
      emitWhenEmpty: false,
      priority: 10,
    },
    deprecated: {
      slot: 'card.footer.right',
      icon: 'pi-ban',
      label: 'deprecated',
      emitWhenEmpty: false,
      priority: 10,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const stability = readStability(node);
      if (stability === 'experimental') {
        ctx.emitContribution(node.path, 'experimental', {
          value: 0,
          tooltip: EXPERIMENTAL_TOOLTIP,
        });
        issues.push({
          analyzerId: ID,
          severity: 'info',
          nodeIds: [node.path],
          message: `Node '${node.path}' is marked experimental: API may change.`,
          data: { stability },
        });
      } else if (stability === 'deprecated') {
        ctx.emitContribution(node.path, 'deprecated', {
          value: 0,
          tooltip: DEPRECATED_TOOLTIP,
          severity: 'warn',
        });
        issues.push({
          analyzerId: ID,
          severity: 'warn',
          nodeIds: [node.path],
          message: `Node '${node.path}' is marked deprecated: avoid in new code.`,
          data: { stability },
        });
      }
    }
    return issues;
  },
};

/**
 * Sidecar `annotations.stability` wins over legacy frontmatter
 * `metadata.stability` (mirror of `effectiveStability` in
 * `ui/src/models/node-derived.ts`). Returns `null` when neither
 * source carries a recognised value.
 */
function readStability(node: Node): 'experimental' | 'deprecated' | 'stable' | null {
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

function isStability(value: unknown): value is 'experimental' | 'deprecated' | 'stable' {
  return value === 'experimental' || value === 'deprecated' || value === 'stable';
}
