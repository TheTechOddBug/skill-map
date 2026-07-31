/**
 * `ascii` formatter. Produces a plain-text dump of the graph for
 * `sm graph --format ascii`. Purposely minimal, a human reads it to
 * grok the shape of a scan, not to study layout. The diagram formatters
 * (`mermaid`, `dot`) are its siblings under `formatters/`.
 *
 * Output layout:
 *
 *   skill-map graph, <N> nodes, <M> links, <K> issues
 *
 *   ## agent (3)
 *   - agents/backend-architect.md, "Backend Architect"
 *   - agents/doc-writer.md, "Doc Writer"
 *
 *   ## command (2)
 *   - commands/deploy.md, "Deploy"
 *
 *   ## links
 *   - agents/a.md --invokes--> agents/b.md     [0.9]
 *   - notes/n.md --references--> notes/m.md    [0.85]
 *
 *   ## issues (1)
 *   - [warn] broken-ref: ...
 */

import type { IBuiltInManifest, IFormatter, IFormatterContext } from '../../../../kernel/extensions/index.js';
import { sanitizeForTerminal } from '../../../../kernel/util/safe-text.js';
import { tx } from '../../../../kernel/util/tx.js';
import { ASCII_FORMATTER_TEXTS } from './ascii.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'ascii';
// Built-in Claude Provider catalog rendered first, in this canonical
// order. Anything else (`'cursorRule'`, `'daily'`, … from external
// Providers) is rendered after, sorted alphabetically, the formatter
// no longer assumes the closed enum and the order stays deterministic.
const KIND_ORDER: readonly string[] = ['agent', 'command', 'skill', 'markdown'];

export const asciiFormatter: IBuiltInManifest<IFormatter> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'formatter',
  // Host-locked (spec architecture.md §Locked extensions): the `sm graph`
  // default format. The verb resolves `--format ascii` when the operator
  // passes no flag, so disabling this formatter would break the bare
  // `sm graph` with no fallback. The sibling formatters (`json`,
  // `mermaid`, `dot`) are opt-in per invocation and stay toggle-able.
  locked: true,
  formatId: ID,
  description: 'Renders the scan as plain text in three sections: nodes (grouped by kind), arrows, and issues. Used by `sm scan --format ascii`.',

  // ASCII tree formatter, header + per-kind sections + per-issue
  // section. Each section iterates and renders; splitting per section
  // would multiply the for-loop boilerplate.
  // eslint-disable-next-line complexity
  format(ctx: IFormatterContext): string {
    const out: string[] = [];
    out.push(
      tx(ASCII_FORMATTER_TEXTS.header, {
        nodes: ctx.nodes.length,
        links: ctx.links.length,
        issues: ctx.issues.length,
      }),
      '',
    );

    // Group nodes by kind. `kind` is an open string, the formatter
    // accepts whatever an enabled Provider classified into.
    const byKind = new Map<string, typeof ctx.nodes>();
    for (const node of ctx.nodes) {
      if (!byKind.has(node.kind)) byKind.set(node.kind, []);
      byKind.get(node.kind)!.push(node);
    }

    // Built-in Claude catalog first in canonical order, then any extra
    // kinds an external Provider emitted, sorted alphabetically so the
    // output stays deterministic across runs.
    const renderedKinds = new Set<string>();
    for (const kind of KIND_ORDER) {
      const group = byKind.get(kind);
      if (!group || group.length === 0) continue;
      renderSection(out, kind, group);
      renderedKinds.add(kind);
    }
    const extraKinds = [...byKind.keys()]
      .filter((k) => !renderedKinds.has(k))
      .sort();
    for (const kind of extraKinds) {
      const group = byKind.get(kind);
      if (!group || group.length === 0) continue;
      renderSection(out, kind, group);
    }

    if (ctx.links.length > 0) {
      out.push(tx(ASCII_FORMATTER_TEXTS.linksSectionHeader, { count: ctx.links.length }));
      const sorted = [...ctx.links].sort((a, b) => {
        const aKey = `${a.source}\0${a.kind}\0${a.target}`;
        const bKey = `${b.source}\0${b.kind}\0${b.target}`;
        return aKey.localeCompare(bKey);
      });
      for (const link of sorted) {
        out.push(
          tx(ASCII_FORMATTER_TEXTS.linkBullet, {
            source: sanitizeForTerminal(link.source),
            kind: sanitizeForTerminal(link.kind),
            target: sanitizeForTerminal(link.target),
            confidence: link.confidence,
          }),
        );
      }
      out.push('');
    }

    if (ctx.issues.length > 0) {
      out.push(tx(ASCII_FORMATTER_TEXTS.issuesSectionHeader, { count: ctx.issues.length }));
      for (const issue of ctx.issues) {
        // Defence in depth: `analyzerId` is regex-validated at registration
        // (matches `[a-z0-9-]+`) but the sibling `message` already
        // sanitizes, wrap `analyzerId` for symmetry so a future loosening
        // of the registry validator can't regress this gate.
        out.push(
          tx(ASCII_FORMATTER_TEXTS.issueBullet, {
            severity: issue.severity,
            analyzerId: sanitizeForTerminal(issue.analyzerId),
            message: sanitizeForTerminal(issue.message),
          }),
        );
      }
      out.push('');
    }

    return out.join('\n');
  },
};

function pickTitle(node: { frontmatter?: Record<string, unknown> }): string | null {
  const name = node.frontmatter?.['name'];
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function renderSection(
  out: string[],
  kind: string,
  group: ReadonlyArray<{ path: string; frontmatter?: Record<string, unknown> }>,
): void {
  const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
  out.push(
    tx(ASCII_FORMATTER_TEXTS.kindSectionHeader, {
      kind: sanitizeForTerminal(kind),
      count: sorted.length,
    }),
  );
  for (const node of sorted) {
    const title = pickTitle(node);
    out.push(
      title
        ? tx(ASCII_FORMATTER_TEXTS.nodeBulletWithTitle, {
            path: sanitizeForTerminal(node.path),
            title: sanitizeForTerminal(title),
          })
        : tx(ASCII_FORMATTER_TEXTS.nodeBullet, { path: sanitizeForTerminal(node.path) }),
    );
  }
  out.push('');
}
