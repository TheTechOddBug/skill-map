/**
 * Annotations extractor. Reads structured references from the sidecar
 * `.sm` `annotations:` block (the canonical home per Decision #125 /
 * Step 9.6) and emits one link per entry:
 *
 *   annotations.supersedes[]     → supersedes links (this node → listed paths)
 *   annotations.supersededBy     → supersedes link (listed path → this node)
 *
 * Frontmatter-scope extractor, the orchestrator passes an empty body.
 * No trigger normalization on these links: the source is structured
 * path strings, not a user-typed invocation. `originalTrigger` and
 * `normalizedTrigger` stay null. Per-node dedup by (target, kind) so
 * the same path listed in both arrays only produces one edge.
 */

import type { IBuiltInManifest, IExtractor, IExtractorContext } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'annotations';

export const annotationsExtractor: IBuiltInManifest<IExtractor> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Turns the `supersedes` and `supersededBy` entries from a node\'s `.sm` sidecar into arrows between nodes in the graph.',
  scope: 'frontmatter',

  extract(ctx: IExtractorContext): void {
    const sourcePath = ctx.node.path;
    const seen = new Set<string>();

    function emit(source: string, target: string, fieldPath: string[]): void {
      const key = `${source} ${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      ctx.emitSignal({
        source,
        scope: 'sidecar',
        fieldPath,
        raw: target,
        candidates: [
          {
            extractorId: ID,
            kind: 'supersedes',
            target,
            confidence: 1.0,
            rationale: 'structured sidecar annotation',
          },
        ],
      });
    }

    const ann = pickAnnotations(ctx.node);
    if (ann) processBlock(ann, sourcePath, emit);
  },
};

type EmitFn = (source: string, target: string, fieldPath: string[]) => void;

function processBlock(block: Record<string, unknown>, sourcePath: string, emit: EmitFn): void {
  const supersedes = stringArray(block['supersedes']);
  for (let i = 0; i < supersedes.length; i += 1) {
    emit(sourcePath, supersedes[i]!, ['annotations', 'supersedes', String(i)]);
  }
  const supersededBy = block['supersededBy'];
  if (typeof supersededBy === 'string' && supersededBy.length > 0) {
    // Inverse direction: the path listed in supersededBy is the new
    // node, and it supersedes `sourcePath`. Emit the edge FROM the new
    // node so consumers can ask "what did X supersede?" with a single
    // query.
    emit(supersededBy, sourcePath, ['annotations', 'supersededBy']);
  }
}

function pickAnnotations(node: IExtractorContext['node']): Record<string, unknown> | null {
  const sidecar = node.sidecar;
  if (!sidecar || sidecar.present !== true) return null;
  const ann = sidecar.annotations;
  if (ann && typeof ann === 'object' && !Array.isArray(ann)) {
    return ann as Record<string, unknown>;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}
