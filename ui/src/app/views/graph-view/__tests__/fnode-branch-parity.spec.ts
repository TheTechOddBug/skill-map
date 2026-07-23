/**
 * Static parity guard for the two `[fNodes]` card branches in
 * `graph-view.html`.
 *
 * The virtualized (`*fVirtualFor`) and non-virtualized (`@for`) branches
 * duplicate the full `<div fNode>` markup ON PURPOSE: Foblex resolves
 * connectors via content queries on the direct view children of
 * `[fNode]`, and routing the inner DOM through `<ng-template>` +
 * `*ngTemplateOutlet` breaks those queries (nodes stack at (0,0) in a
 * redraw loop). The duplication is load-bearing, which makes it a
 * classic rot vector: an attribute edited in one branch and forgotten
 * in the other ships silently, and since virtualization is OFF by
 * default the stale branch is the one every user runs. That exact
 * drift happened once (`fInputConnectableSide` hardcoded to "top" in
 * the default branch while the virtualized one tracked `inputSide()`),
 * breaking direction-aware connector anchors for every default user.
 *
 * This guard compares the two card blocks byte-for-byte after
 * normalisation (whitespace collapsed, HTML comments stripped, the
 * `*fVirtualFor` / `@for` iteration chrome removed). Any future edit
 * to one branch fails the suite until the twin is updated too.
 *
 * Same raw-template loading pattern as `src/__tests__/noopener-guard.spec.ts`:
 * `import.meta.glob` is rewritten by Vite at build time, so the call
 * must be the literal syntax with a literal pattern.
 */

import { describe, expect, it } from 'vitest';

type TGlobResult = Record<string, string>;
const templates = (import.meta as ImportMeta & {
  glob: (pattern: string, opts: { eager: true; query: '?raw'; import: 'default' }) => TGlobResult;
}).glob('../graph-view.html', { eager: true, query: '?raw', import: 'default' });

/** Slice the branch bodies out of the template. Anchored on the
 *  `@if (perf.virtualization)` / `} @else {` control-flow markers,
 *  which are structural to the twin-branch design this guard exists
 *  to protect (renaming them means redesigning the guard too). */
function extractBranches(src: string): { virtualized: string; plain: string } {
  const ifIdx = src.indexOf('@if (perf.virtualization)');
  const elseIdx = src.indexOf('} @else {', ifIdx);
  expect(ifIdx, 'virtualization @if branch not found').toBeGreaterThanOrEqual(0);
  expect(elseIdx, '@else branch not found').toBeGreaterThan(ifIdx);
  const elseEnd = src.indexOf('</ng-container>', elseIdx);
  expect(elseEnd, 'closing ng-container of the @else branch not found').toBeGreaterThan(elseIdx);
  return {
    virtualized: src.slice(ifIdx, elseIdx),
    plain: src.slice(elseIdx, elseEnd + '</ng-container>'.length),
  };
}

/** Reduce a branch to its `<div fNode>` card block, normalised:
 *  first `<div` through last `</div>`, comments stripped, whitespace
 *  collapsed. The iteration chrome (`*fVirtualFor` attribute vs the
 *  `@for` block) lives OUTSIDE the extracted div, so what remains is
 *  exactly the markup that must stay identical across branches. */
function cardBlockOf(branch: string): string {
  const start = branch.indexOf('<div');
  const end = branch.lastIndexOf('</div>');
  expect(start, '<div fNode> block not found in branch').toBeGreaterThanOrEqual(0);
  expect(end, 'closing </div> not found in branch').toBeGreaterThan(start);
  return branch
    .slice(start, end + '</div>'.length)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('graph-view [fNodes] twin branches stay in lockstep', () => {
  it('the virtualized and default card blocks are identical after normalisation', () => {
    const src = Object.values(templates)[0];
    expect(src, 'graph-view.html not resolved by the glob').toBeTruthy();
    const { virtualized, plain } = extractBranches(src!);
    const a = cardBlockOf(virtualized);
    const b = cardBlockOf(plain);
    if (a !== b) {
      // Point at the first divergence so the failure is actionable
      // without eyeballing two 1.5k-char strings.
      let i = 0;
      while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
      const ctx = (s: string): string => s.slice(Math.max(0, i - 60), i + 60);
      throw new Error(
        'The two <div fNode> card branches in graph-view.html drifted apart. ' +
          'They MUST stay attribute-identical (the duplication is load-bearing, ' +
          'see the template comment above the @if). First divergence:\n' +
          `  virtualized: ...${ctx(a)}...\n` +
          `  default:     ...${ctx(b)}...`,
      );
    }
    expect(a).toBe(b);
  });

  it('both branches declare the unified fConnector bindings', () => {
    // Belt-and-braces for the drift that motivated this guard (a
    // connector binding edited in one branch and forgotten in the
    // other). Since v19's unified model the card carries a single
    // source-target connector whose id IS the node id; the
    // direction-aware sides moved to the `<f-connection>` bindings
    // (`fSourceSide`/`fTargetSide`), which live outside the twin
    // branches and cannot drift between them.
    const src = Object.values(templates)[0]!;
    const { virtualized, plain } = extractBranches(src);
    for (const branch of [virtualized, plain]) {
      expect(branch).toContain('fConnector');
      expect(branch).toContain('fConnectorType="source-target"');
      expect(branch).toContain('[fConnectorId]="node.id"');
    }
  });
});
