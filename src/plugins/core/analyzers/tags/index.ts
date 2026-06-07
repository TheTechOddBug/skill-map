/**
 * `tags` analyzer. Emits NO issues; it only projects the inspector
 * action button that lets the operator edit the taxonomy tags of the
 * current node (dispatches `core/node-set-tags`).
 *
 * Mirrors how `core/supersede` projects the `core/node-supersede`
 * button and `core/annotation-stale` projects the `core/node-bump`
 * button: a declarer/editor affordance, not a finding.
 *
 * Behaviour:
 *
 *   - For every node that already has a sidecar (`node.sidecar.present
 *     === true`) it emits one `inspector.action.button` contribution.
 *     Nodes with no sidecar are skipped so the inspector never offers to
 *     scaffold a `.sm` (creation is CLI-only), matching
 *     `core/annotation-stale`'s bump-button gate.
 *   - The payload's `prompt` declares a `string-list` input the UI
 *     collects (`tags` = the full taxonomy array) before dispatch. Its
 *     `defaultValue` pre-loads the node's current tags so the edit reads
 *     as add / remove / modify over the existing set.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Node } from '../../../../kernel/types.js';
import { TAGS_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'tags';

export const tagsAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Projects the inspector "Edit tags" button (edits a node\'s taxonomy tags).',
  mode: 'deterministic',

  ui: {
    // Inspector action button that dispatches `core/node-set-tags`.
    // Emitted for every node that already has a sidecar; the prompt
    // pre-loads the current tags as its `defaultValue`.
    setTagsButton: {
      slot: 'inspector.action.button',
      priority: 15,
    },
  },

  evaluate(ctx: IAnalyzerContext): Issue[] {
    for (const node of ctx.nodes) {
      if (node.sidecar?.present !== true) continue;
      emitSetTagsButton(ctx, node);
    }
    // This analyzer surfaces no issues; it only projects the button.
    return [];
  },
};

function emitSetTagsButton(ctx: IAnalyzerContext, node: Node): void {
  ctx.emitContribution(node.path, 'setTagsButton', {
    actionId: 'core/node-set-tags',
    label: TAGS_TEXTS.editLabel,
    icon: 'pi-tags',
    enabled: true,
    prompt: {
      inputType: 'string-list',
      paramKey: 'tags',
      label: TAGS_TEXTS.promptLabel,
      defaultValue: currentTags(node),
    },
  });
}

/**
 * The node's current `annotations.tags` from its sidecar overlay, or
 * `[]` when absent / malformed. Drives the prompt's `defaultValue` so
 * the editor opens pre-loaded with the existing taxonomy.
 */
function currentTags(node: Node): string[] {
  const ann = node.sidecar?.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) return [];
  const value = (ann as Record<string, unknown>)['tags'];
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === 'string');
}
