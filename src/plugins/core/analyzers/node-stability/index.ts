/**
 * `node-stability` analyzer. Reads the lifecycle stage of each node via the
 * shared `readEffectiveStability` helper (sidecar `annotations.stability`
 * first, Decision #125 / Step 9.6 canonical home, then legacy frontmatter
 * `metadata.stability` for un-migrated `.md` files) and surfaces it as a
 * `card.footer.right` chip:
 *
 *   - `deprecated` -> a `pi-ban` chip (warn tint) PLUS a `warn` issue, so
 *     the end-of-life state shows in `sm check` and the inspector's issues
 *     panel.
 *   - `experimental` -> an `fa-flask` chip ONLY. Experimental is a visual
 *     badge, not a finding, so it raises no issue (it used to emit an
 *     `info`; that was dropped as Findings noise).
 *   - `stable` / unset -> nothing.
 *
 * The inspector "Set stability" button is NOT projected here: it
 * self-projects from the `core/node-set-stability` action's scan-time
 * `project()` (the button lives with the action that dispatches it, so a
 * disabled action shows no button). This analyzer only READS the field.
 *
 * Moved from `extractors/` to `analyzers/`: this code never produced
 * structural data (no links, no derived fields), it interprets an existing
 * field, which is the analyzer pattern. Sits next to the other
 * `card.footer.right` analyzers (`annotation-stale`,
 * `annotation-field-unknown`, `reference-broken`). The plugin id stays
 * `core/node-stability`; only the `kind` flipped from `extractor` to
 * `analyzer`.
 *
 * The two values that produce a chip (`experimental` / `deprecated`) are
 * mutually exclusive on a node, so at most one chip (and, for `deprecated`,
 * one issue) fires per node. The `.sm-gnode--deprecated` host fade in the
 * card component is independent, it reads `effectiveStability(node)` directly.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import type { IViewContribution } from '../../../../kernel/types/view-catalog.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { readEffectiveStability } from '../../stability.js';
import { NODE_STABILITY_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'node-stability';

const EXPERIMENTAL_TOOLTIP = 'Experimental: API may change';
const DEPRECATED_TOOLTIP = 'Deprecated: avoid in new code';

// First in the footer-right cluster: stability is the node's declared
// lifecycle state, so it leads, followed by the drift chip and then the
// severity counters. It's a state badge, not a count, so it stays left
// of the numeric zone.
const experimental = {
  slot: 'card.footer.right',
  icon: 'fa-solid fa-flask',
  label: 'experimental',
  emitWhenEmpty: false,
  priority: 10,
} satisfies IViewContribution;

const deprecated = {
  slot: 'card.footer.right',
  icon: 'pi-ban',
  label: 'deprecated',
  emitWhenEmpty: false,
  priority: 10,
} satisfies IViewContribution;

export const nodeStabilityAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Surfaces a node\'s stability stage on the card: `deprecated` as a chip plus a finding, `experimental` as a chip only; `stable` and unset stay silent.',
  mode: 'deterministic',

  ui: { experimental, deprecated },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      const stability = readEffectiveStability(node);

      if (stability === 'experimental') {
        ctx.emitContribution(node.path, experimental, {
          value: 0,
          tooltip: EXPERIMENTAL_TOOLTIP,
        });
      } else if (stability === 'deprecated') {
        ctx.emitContribution(node.path, deprecated, {
          value: 0,
          tooltip: DEPRECATED_TOOLTIP,
          severity: 'warn',
        });
        issues.push({
          analyzerId: ID,
          severity: 'warn',
          nodeIds: [node.path],
          message: formatFinding({ body: tx(NODE_STABILITY_TEXTS.deprecated) }),
          data: { stability },
        });
      }
    }
    return issues;
  },
};
