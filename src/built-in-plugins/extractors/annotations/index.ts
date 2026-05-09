/**
 * Annotations extractor. Reads structured references from the sidecar
 * `.sm` `annotations:` block (the canonical home per Decision #125 /
 * Step 9.6) and emits one link per entry:
 *
 *   annotations.supersedes[]     → supersedes links (this node → listed paths)
 *   annotations.supersededBy     → supersedes link (listed path → this node)
 *   annotations.requires[]       → references links
 *   annotations.related[]        → references links
 *   annotations.conflictsWith[]  → references links
 *
 * Frontmatter-scope extractor — the orchestrator passes an empty body.
 * No trigger normalization on these links: the source is structured
 * path strings, not a user-typed invocation. `originalTrigger` and
 * `normalizedTrigger` stay null. Per-node dedup by (target, kind) so
 * the same path listed in two annotation arrays only produces one
 * edge.
 *
 * Phase 6 / view contributions: this extractor also surfaces the
 * parsed frontmatter top-level scalars to the inspector via
 * `node-key-values`. That responsibility is co-located here for
 * now (the YAML frontmatter is already parsed in the orchestrator
 * pipeline) and may be split out if it grows beyond a thin projection.
 */

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';
import type { Link } from '../../../kernel/types.js';

const ID = 'annotations';

export const annotationsExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Reads structured references from the sidecar `.sm` `annotations:` block (supersedes, supersededBy, requires, related, conflictsWith).',
  stability: 'stable',
  emitsLinkKinds: ['supersedes', 'references'],
  defaultConfidence: 'high',
  scope: 'frontmatter',

  /**
   * Phase 6 / View contribution system — surface the parsed
   * frontmatter top-level scalar fields as a key-value list in the
   * inspector body so the user sees what the kernel actually parsed
   * without opening the file. Empty payload (`emitWhenEmpty: false`)
   * means nodes with empty / no frontmatter stay silent.
   */
  viewContributions: {
    parsed: {
      contract: 'node-key-values',
      label: 'Frontmatter',
      emptyText: 'No frontmatter on this node.',
      emitWhenEmpty: false,
    },
  },

  extract(ctx: IExtractorContext): void {
    const sourcePath = ctx.node.path;
    const seen = new Set<string>();

    function emit(source: string, target: string, kind: 'supersedes' | 'references'): void {
      const key = `${source} ${target} ${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      ctx.emitLink(link(source, target, kind));
    }

    const ann = pickAnnotations(ctx.node);
    if (ann) processBlock(ann, sourcePath, emit);

    // Phase 6 — surface the parsed frontmatter scalar fields via the
    // `node-key-values` contract. Skips arrays/objects (those are
    // either already linked above or not useful as flat rows).
    const entries = scalarFrontmatterEntries(ctx.frontmatter);
    if (entries.length > 0) {
      ctx.emitContribution('parsed', { entries });
    }
  },
};

/**
 * Project the parsed frontmatter to scalar key/value pairs for the
 * `node-key-values` contract. Skips arrays / objects (handled
 * above as edges or not useful here). Caps at 50 defensively (the
 * contract's hard limit).
 */
function scalarFrontmatterEntries(
  frontmatter: Record<string, unknown>,
): Array<{ key: string; value: string | number | boolean | null }> {
  const out: Array<{ key: string; value: string | number | boolean | null }> = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (out.length >= 50) break;
    if (value === null || value === undefined) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out.push({ key, value });
    }
  }
  return out;
}

type EmitFn = (source: string, target: string, kind: 'supersedes' | 'references') => void;

function processBlock(block: Record<string, unknown>, sourcePath: string, emit: EmitFn): void {
  for (const target of stringArray(block['supersedes'])) {
    emit(sourcePath, target, 'supersedes');
  }
  const supersededBy = block['supersededBy'];
  if (typeof supersededBy === 'string' && supersededBy.length > 0) {
    // Inverse direction: the path listed in supersededBy is the new
    // node, and it supersedes `sourcePath`. Emit the edge FROM the new
    // node so consumers can ask "what did X supersede?" with a single
    // query.
    emit(supersededBy, sourcePath, 'supersedes');
  }
  for (const target of stringArray(block['requires'])) {
    emit(sourcePath, target, 'references');
  }
  for (const target of stringArray(block['related'])) {
    emit(sourcePath, target, 'references');
  }
  for (const target of stringArray(block['conflictsWith'])) {
    emit(sourcePath, target, 'references');
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

function link(source: string, target: string, kind: 'supersedes' | 'references'): Link {
  return {
    source,
    target,
    kind,
    confidence: 'high',
    sources: [ID],
  };
}
