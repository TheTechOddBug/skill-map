/**
 * `annotation-orphan` rule (Step 9.6.2). Emits one `warn` issue per
 * orphaned `.sm` sidecar, a YAML sidecar whose sibling `.md` does not
 * exist on disk.
 *
 * Orphan detection runs in the kernel walker (`discoverOrphanSidecars`);
 * this rule just projects the discovered list as graph-level issues so
 * the standard issue surface (CLI, UI, REST) reports them without
 * bespoke plumbing. `nodeIds` is empty because the orphan has no live
 * node to attribute against, consumers key on `data.sidecarPath`
 * instead.
 *
 * Severity is `warn` per Decision #4, orphan cleanup is gated by
 * `sm prune-annotations` (Step 9.6.4); the warning prompts the user
 * but never blocks.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { Issue } from '../../../kernel/types.js';
import { tx } from '../../../kernel/util/tx.js';
import { ANNOTATION_ORPHAN_TEXTS } from '../../i18n/annotation-orphan.texts.js';

const ID = 'annotation-orphan';

export const annotationOrphanAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Detects and flags sidecars (`.sm`) whose `.md` no longer exists.',
  stability: 'stable',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const orphans = ctx.orphanSidecars;
    if (!orphans || orphans.length === 0) return [];
    const issues: Issue[] = [];
    for (const orphan of orphans) {
      // The orphan has no live node by definition; use the expected
      // `.md` (relative) path as the nodeId so the issue shape satisfies
      // `issue.schema.json#/properties/nodeIds/minItems: 1`. Consumers
      // disambiguate against `data.sidecarPath` / `data.expectedMdPath`
      // when they need to know it was an orphan rather than a real node.
      const expectedMdRelative = orphan.relativePath.endsWith('.sm')
        ? `${orphan.relativePath.slice(0, -'.sm'.length)}.md`
        : `${orphan.relativePath}.md`;
      issues.push({
        analyzerId: ID,
        severity: 'warn',
        nodeIds: [expectedMdRelative],
        message: tx(ANNOTATION_ORPHAN_TEXTS.message, {
          sidecarPath: orphan.relativePath,
          expectedMdPath: orphan.expectedMdPath,
        }),
        data: {
          sidecarPath: orphan.relativePath,
          expectedMdPath: orphan.expectedMdPath,
        },
      });
    }
    return issues;
  },
};
