/**
 * Unit coverage for `reference-broken`:
 *   - Issue emission per unresolved link (error severity, `nodeIds: [source]`).
 *   - Score-phase confidence penalty: every broken link surfaced (i.e.
 *     after the `referenceablePaths` escape hatch) gets a
 *     `ctx.adjustConfidence(link, { kind: 'delta', value: -BROKEN_PENALTY })`.
 *     The kernel seeds a 1.0 baseline on every link, so the penalty folds
 *     to `1.0 - 0.75 = 0.25`. Detection and scoring travel together: a link
 *     suppressed by the escape hatch gets neither an issue nor an op.
 *     There is NO confidence gate: the delta fires regardless of the
 *     link's confidence; only the score-phase `adjustConfidence` presence
 *     bounds the adjustment (a detect/aggregate ctx supplies none).
 *
 * The per-node aggregate chip moved to `core/issue-counter`; this
 * analyzer declares no `ui` surface. The recorded ops are captured via a
 * recording `adjustConfidence`.
 */

import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { referenceBrokenAnalyzer } from '../index.js';
import { REFERENCE_BROKEN_TEXTS } from '../reference-broken.texts.js';
import { BROKEN_PENALTY } from '../../../../../kernel/orchestrator/confidence-constants.js';
import type { IAnalyzerContext } from '../../../../../kernel/extensions/index.js';
import type { Link, Node, TConfidenceOp } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

function fakeNode(path: string, name?: string): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'core-markdown',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(name ? { frontmatter: { name, description: '' } } : {}),
  } as Node;
}

function fakeLink(source: string, target: string): Link {
  return {
    source,
    target,
    kind: 'references',
    confidence: 0.9,
    sources: ['mock'],
  };
}

/** An `@`-trigger mention as the at-directive extractor materialises it. */
function fakeMention(source: string, target: string): Link {
  return {
    source,
    target,
    kind: 'mentions',
    confidence: 0.5,
    sources: ['at-directive'],
    trigger: {
      originalTrigger: target,
      normalizedTrigger: target.toLowerCase(),
    },
  };
}

/**
 * One recorded `adjustConfidence` call, by link object identity.
 */
interface IRecordedOp {
  link: Link;
  op: TConfidenceOp;
}

// `reference-broken` is a pure projector of the orchestrator's
// genuinely-broken verdict, so the unit test supplies `brokenLinks`
// directly (the kind-agnostic detection itself lives in the lift's
// `collectBrokenLinks`, covered by that module's tests). `extra` carries
// the optional score-phase wiring (`cwd` + `referenceablePaths` for the
// escape hatch); pass `{ adjust: false }` to model a legacy/detect ctx
// that supplies no `adjustConfidence` at all.
function run(
  nodes: Node[],
  links: Link[],
  brokenLinks: Set<Link>,
  extra?: Partial<IAnalyzerContext> & { adjust?: boolean },
): {
  issues: {
    nodeIds: readonly string[];
    severity: string;
    message?: string;
    fix?: { summary?: string } | null;
  }[];
  contributions: { nodePath: string; id: string; payload: unknown }[];
  ops: IRecordedOp[];
} {
  const contributions: { nodePath: string; id: string; payload: unknown }[] = [];
  const ops: IRecordedOp[] = [];
  const { adjust = true, ...ctxOver } = extra ?? {};
  const ctx = {
    nodes,
    links,
    brokenLinks,
    emitContribution: (nodePath: string, id: string, payload: unknown) =>
      contributions.push({ nodePath, id, payload }),
    ...(adjust
      ? {
          adjustConfidence: (link: Link, op: TConfidenceOp) => {
            ops.push({ link, op });
          },
        }
      : {}),
    // The kernel always binds `ctx.log`; the double cast below
    // silences the required field, so supply it explicitly or the
    // helper drifts from the real context shape.
    log: SILENT_EXTENSION_LOGGER,
    ...ctxOver,
  } as unknown as IAnalyzerContext;
  const result = referenceBrokenAnalyzer.evaluate!(ctx);
  const issues = Array.isArray(result) ? result : [];
  return { issues, contributions, ops };
}

describe('broken-ref analyzer, issue emission', () => {
  it('emits nothing when no link is in the broken set', () => {
    const a = fakeNode('a.md');
    const b = fakeNode('b.md');
    const { issues, contributions } = run([a, b], [fakeLink('a.md', 'b.md')], new Set());
    strictEqual(issues.length, 0);
    strictEqual(contributions.length, 0);
  });

  it('emits 1 issue per broken ref and records 1 delta op', () => {
    const a = fakeNode('a.md');
    const link = fakeLink('a.md', 'missing.md');
    const { issues, contributions, ops } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'error');
    deepStrictEqual(issues[0]!.nodeIds, ['a.md']);
    // Remediation hint lives in `fix.summary`, not appended to message;
    // it points at the `scan.referencePaths` escape hatch by its Settings label.
    ok(issues[0]!.fix?.summary?.includes('Folders for link validation'));
    // Per-node chip emission moved out, the aggregate severity chip
    // (`core/issue-counter`) handles the visual surface now.
    strictEqual(contributions.length, 0);
    // Score side: the broken edge gets the penalty delta (folds to 0.25
    // on the kernel's 1.0 baseline).
    strictEqual(ops.length, 1);
    strictEqual(ops[0]!.link, link);
    deepStrictEqual(ops[0]!.op, { kind: 'delta', value: -BROKEN_PENALTY });
  });

  it('emits one issue per broken ref without aggregating into a chip (and one delta op each)', () => {
    const a = fakeNode('a.md');
    const links = [
      fakeLink('a.md', 'missing-1.md'),
      fakeLink('a.md', 'missing-2.md'),
      fakeLink('a.md', 'missing-3.md'),
    ];
    const { issues, contributions, ops } = run([a], links, new Set(links));
    strictEqual(issues.length, 3, 'three issues, one per broken link');
    strictEqual(contributions.length, 0, 'no per-analyzer chip; aggregated by issue-counter');
    // One delta op per broken link, same shape.
    strictEqual(ops.length, 3, 'three delta ops, one per broken link');
    for (const recorded of ops) {
      deepStrictEqual(recorded.op, { kind: 'delta', value: -BROKEN_PENALTY });
    }
  });

  it('skips a link that is NOT in the broken set even if its target looks unresolvable', () => {
    // The projector trusts the orchestrator verdict: a link the lift
    // resolved via a filename / dirname identifier is absent from
    // `brokenLinks`, so the rule does not flag it (the old
    // frontmatter-name-only index used to false-positive here).
    const caller = fakeNode('caller.md');
    const resolvedByFilename = fakeLink('caller.md', '@filed-agent');
    const { issues } = run([caller], [resolvedByFilename], new Set());
    strictEqual(issues.length, 0);
  });

  it('suppresses both the issue AND the op when the link resolves via referencePaths', () => {
    // A path-style `references` link that IS in `brokenLinks`, but whose
    // absolute resolution lands in the operator-configured side index.
    // The escape hatch fires BEFORE issue + score, so detection and
    // scoring skip together: no error, no ceil op.
    const caller = fakeNode('caller.md');
    const outsideLink = fakeLink('caller.md', './outside.md');
    const { issues, ops } = run([caller], [outsideLink], new Set([outsideLink]), {
      cwd: '/proj',
      referenceablePaths: new Set([resolve('/proj', './outside.md')]),
    });
    strictEqual(issues.length, 0, 'reference-paths resolution suppresses the error');
    strictEqual(ops.length, 0, 'no penalty when the link resolved outside the graph');
  });

  it('records the delta even when the broken link is already at confidence 1.0 (no gate)', () => {
    // There is NO confidence gate: a full-confidence broken link (e.g. an
    // annotation-derived link, or the kernel's 1.0 baseline) surfaces the
    // structural error AND gets the penalty delta, which folds 1.0 down to
    // the broken floor (0.25).
    const a = fakeNode('a.md');
    const fullLink: Link = {
      source: 'a.md',
      target: 'missing.md',
      kind: 'references',
      confidence: 1.0,
      sources: ['annotations'],
    };
    const { issues, ops } = run([a], [fullLink], new Set([fullLink]));
    strictEqual(issues.length, 1, 'the error fires regardless of confidence');
    strictEqual(issues[0]!.severity, 'error');
    strictEqual(ops.length, 1, 'the penalty delta fires at confidence 1.0: no gate');
    deepStrictEqual(ops[0]!.op, { kind: 'delta', value: -BROKEN_PENALTY });
  });

  it('still emits errors and never throws when ctx has no adjustConfidence (legacy/detect caller)', () => {
    // A detect/aggregate caller supplies no `adjustConfidence`; detection
    // runs unchanged, the score side short-circuits, nothing throws.
    const a = fakeNode('a.md');
    const link = fakeLink('a.md', 'missing.md');
    const { issues, ops } = run([a], [link], new Set([link]), { adjust: false });
    strictEqual(issues.length, 1, 'the error still fires without a scorer');
    strictEqual(issues[0]!.severity, 'error');
    strictEqual(ops.length, 0, 'no op recorded with no adjustConfidence on ctx');
  });

  it('declares no `ui` surface (issue chip is owned by `core/issue-counter`)', () => {
    deepStrictEqual(referenceBrokenAnalyzer.ui, {});
  });
});

describe('broken-ref analyzer, code-shaped severity downgrade', () => {
  it('downgrades an uppercase decorator-shaped at-trigger to warn, penalty intact', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', '@ApiSecurity');
    const { issues, ops } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1, 'the issue still fires, warn tier');
    strictEqual(issues[0]!.severity, 'warn');
    // User decision 2026-07-27: broken is broken, the full penalty stays.
    strictEqual(ops.length, 1);
    deepStrictEqual(ops[0]!.op, { kind: 'delta', value: -BROKEN_PENALTY });
  });

  it('downgrades an npm-scope-shaped at-trigger to warn with the code-shaped hint', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', '@nestjs/swagger');
    const { issues } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'warn');
    ok(issues[0]!.message?.includes('code identifier or npm package'));
  });

  it('keeps a lowercase handle-shaped at-trigger at error severity', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', '@my-agent');
    const { issues } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'error');
  });

  it('keeps a path-style broken link at error even with uppercase in the target', () => {
    // The downgrade is gated on the `@` trigger sigil; a `references`
    // link to `Missing.md` is a real dangling path, not prose about code.
    const a = fakeNode('a.md');
    const link = fakeLink('a.md', 'Missing.md');
    const { issues } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 1);
    strictEqual(issues[0]!.severity, 'error');
  });
});

describe('broken-ref analyzer, operator issue suppressions', () => {
  const SUPPRESSED = '@ApiSecurity';

  function sidecarRootsWith(analyzer: string, value: string): Map<string, Record<string, unknown>> {
    return new Map([
      ['a.md', { annotations: { issueSuppressions: [{ analyzer, value }] } }],
    ]);
  }

  it('skips the issue AND the penalty on a qualified-id suppression match', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', SUPPRESSED);
    const { issues, ops } = run([a], [link], new Set([link]), {
      sidecarRoots: sidecarRootsWith('core/reference-broken', SUPPRESSED),
    });
    strictEqual(issues.length, 0, 'the dismissed value emits nothing');
    strictEqual(ops.length, 0, 'the penalty skips with the issue: one decision');
  });

  it('matches a bare short analyzer id the same way', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', SUPPRESSED);
    const { issues, ops } = run([a], [link], new Set([link]), {
      sidecarRoots: sidecarRootsWith('reference-broken', SUPPRESSED),
    });
    strictEqual(issues.length, 0);
    strictEqual(ops.length, 0);
  });

  it('still emits for a different value (matching is exact and case-sensitive)', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', '@apisecurity');
    const { issues } = run([a], [link], new Set([link]), {
      sidecarRoots: sidecarRootsWith('core/reference-broken', SUPPRESSED),
    });
    strictEqual(issues.length, 1, 'a lowercased sibling token is a different key');
  });

  it('falls back to the typed sidecar overlay when sidecarRoots is absent', () => {
    const a = {
      ...fakeNode('a.md'),
      sidecar: {
        annotations: { issueSuppressions: [{ analyzer: 'core/reference-broken', value: SUPPRESSED }] },
      },
    } as unknown as Node;
    const link = fakeMention('a.md', SUPPRESSED);
    const { issues, ops } = run([a], [link], new Set([link]));
    strictEqual(issues.length, 0);
    strictEqual(ops.length, 0);
  });

  it('a suppression on another node does not silence this source', () => {
    const a = fakeNode('a.md');
    const link = fakeMention('a.md', SUPPRESSED);
    const { issues } = run([a], [link], new Set([link]), {
      sidecarRoots: new Map([
        ['other.md', { annotations: { issueSuppressions: [{ analyzer: 'core/reference-broken', value: SUPPRESSED }] } }],
      ]),
    });
    strictEqual(issues.length, 1, 'suppressions are per node');
  });
});

// Silence unused-import warnings for shared text catalog referenced by
// other suites in this file in the past.
void REFERENCE_BROKEN_TEXTS;
