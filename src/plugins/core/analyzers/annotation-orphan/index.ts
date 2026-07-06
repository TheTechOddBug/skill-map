/**
 * `annotation-orphan` rule (Step 9.6.2). Emits one `warn` issue per
 * orphaned `.sm` sidecar, a YAML sidecar whose sibling `.md` does not
 * exist on disk.
 *
 * Orphan detection runs in the kernel walker (`discoverOrphanSidecars`);
 * this rule just projects the discovered list as graph-level issues so
 * the standard issue surface (CLI, UI, REST) reports them without
 * bespoke plumbing. The orphan has no live node, so `nodeIds` carries
 * the would-be `.md` path (the missing sibling) to satisfy the schema's
 * `minItems: 1`; consumers key on `data.sidecarPath` / `data.expectedMdPath`
 * to tell an orphan from a real node.
 *
 * Severity is `warn` per Decision #4, orphan cleanup is gated by
 * `sm prune-annotations` (Step 9.6.4); the warning prompts the user
 * but never blocks.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { ANNOTATION_ORPHAN_TEXTS } from './annotation-orphan.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'annotation-orphan';

export const annotationOrphanAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Flags sidecars (`.sm`) whose `.md` file no longer exists.',
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
        message: formatFinding({
          subject: orphan.relativePath,
          body: tx(ANNOTATION_ORPHAN_TEXTS.message),
        }),
        fix: { summary: tx(ANNOTATION_ORPHAN_TEXTS.fixSummary) },
        data: {
          sidecarPath: orphan.relativePath,
          expectedMdPath: orphan.expectedMdPath,
        },
      });
    }
    return issues;
  },
};
