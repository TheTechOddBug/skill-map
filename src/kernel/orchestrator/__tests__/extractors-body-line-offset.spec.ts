/**
 * Body-line-offset wiring: persisted line numbers are FILE-absolute.
 *
 * Extractors track lines against the body they receive (frontmatter
 * excluded); the orchestrator adds the parser-owned
 * `IRawNode.bodyLineOffset` to every body-scoped Signal at emit time
 * (`applyBodyLineOffset` inside `runExtractorsForNode`), so
 * `link.location.line`, and every `L<n>` derived from it, matches what
 * the author's editor shows. These tests pin:
 *
 *   (a) Runner level: a body-scoped Signal's `range.line` is shifted by
 *       `bodyLineOffset`; frontmatter-scoped Signals and Signals with
 *       no tracked line are untouched; offset 0 / absent is a no-op.
 *   (b) End-to-end: scanning a skill whose frontmatter block occupies
 *       four file lines yields a link whose `location.line` counts
 *       those lines (the historic behaviour reported the body-relative
 *       line instead).
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryProgressEmitter, createKernel, runExtractorsForNode, runScan } from '../../index.js';
import { builtIns } from '../../../plugins/built-ins.js';
import type { IExtractor } from '../../extensions/index.js';
import type { Node, Signal } from '../../types.js';

function makeNode(path: string): Node {
  return {
    path,
    kind: 'skill',
    name: 'probe',
    provider: 'claude',
    hashes: { frontmatter: 'x', body: 'x', node: 'x' },
    bytes: { frontmatter: 0, body: 0, total: 0 },
  } as unknown as Node;
}

/** Probe extractor emitting the three Signal shapes the offset logic branches on. */
const signalProbe: IExtractor = {
  kind: 'extractor',
  id: 'line-probe',
  pluginId: 'test-plugin',
  version: '1.0.0',
  description: 'test',
  scope: 'both',
  extract: (ctx): void => {
    const candidate = {
      extractorId: 'line-probe',
      kind: 'references' as const,
      target: 'other.md',
      confidence: 0.9,
      rationale: 'test',
    };
    // Body-scoped with a tracked line: MUST shift.
    ctx.emitSignal({
      source: ctx.node.path,
      scope: 'body',
      range: { start: 0, end: 5, line: 2 },
      raw: 'a',
      candidates: [candidate],
    });
    // Body-scoped without a tracked line: stays line-less.
    ctx.emitSignal({
      source: ctx.node.path,
      scope: 'body',
      range: { start: 6, end: 9 },
      raw: 'b',
      candidates: [candidate],
    });
    // Frontmatter-scoped: never shifted (its location is fieldPath-based).
    ctx.emitSignal({
      source: ctx.node.path,
      scope: 'frontmatter',
      range: { start: 0, end: 3, line: 2 },
      raw: 'c',
      candidates: [candidate],
    });
  },
};

async function runProbe(bodyLineOffset?: number): Promise<Signal[]> {
  const { signals } = await runExtractorsForNode({
    extractors: [signalProbe],
    node: makeNode('.claude/skills/probe/SKILL.md'),
    body: 'a int b',
    frontmatter: {},
    bodyHash: 'x',
    emitter: new InMemoryProgressEmitter(),
    ...(bodyLineOffset !== undefined ? { bodyLineOffset } : {}),
  });
  return signals;
}

describe('body line offset (runner level)', () => {
  it('shifts a body-scoped Signal line by the offset, leaves the rest alone', async () => {
    const signals = await runProbe(4);
    strictEqual(signals.length, 3);
    strictEqual(signals[0]?.range?.line, 6, 'body line 2 + offset 4 = file line 6');
    strictEqual(signals[0]?.range?.start, 0, 'byte offsets stay body-relative');
    strictEqual(signals[1]?.range?.line, undefined, 'no tracked line stays untracked');
    strictEqual(signals[2]?.range?.line, 2, 'frontmatter scope is untouched');
  });

  it('offset absent or 0 is a no-op', async () => {
    for (const offset of [undefined, 0]) {
      const signals = await runProbe(offset);
      strictEqual(signals[0]?.range?.line, 2);
    }
  });
});

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-line-offset-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // Frontmatter block occupies file lines 1-4; the markdown link sits on
  // body line 2 = file line 6. The first-line link pins the edge case
  // body line 1 = file line 5.
  write(
    '.claude/skills/probe/SKILL.md',
    [
      '---',
      'name: probe',
      'description: D',
      '---',
      'First: [first](./first.md).',
      'See [the other doc](./other.md).',
      '',
    ].join('\n'),
  );
  write('.claude/skills/probe/other.md', 'Target.\n');
  write('.claude/skills/probe/first.md', 'Target.\n');
  // No frontmatter at all: the body IS the whole file, offset 0, so the
  // link on line 2 stays line 2.
  write('.claude/skills/probe/plain.md', 'Prose intro.\nGo [back](./other.md).\n');
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('body line offset (end-to-end scan)', () => {
  async function scanFixture(): Promise<Awaited<ReturnType<typeof runScan>>> {
    const kernel = createKernel();
    const baseline = builtIns();
    return runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: baseline.extractors,
        analyzers: [],
      },
    });
  }

  it('persists file-absolute link locations, frontmatter counted', async () => {
    const result = await scanFixture();
    const link = result.links.find(
      (l) => l.source.endsWith('SKILL.md') && l.target.endsWith('other.md'),
    );
    ok(link, 'expected the markdown link to resolve');
    strictEqual(link.location?.line, 6, 'body line 2 + 4 frontmatter lines = file line 6');
  });

  it('body line 1 lands right after the closing fence', async () => {
    const result = await scanFixture();
    const link = result.links.find(
      (l) => l.source.endsWith('SKILL.md') && l.target.endsWith('first.md'),
    );
    ok(link, 'expected the first-line link to resolve');
    strictEqual(link.location?.line, 5, 'body line 1 + 4 frontmatter lines = file line 5');
  });

  it('a file without frontmatter keeps its lines unshifted', async () => {
    const result = await scanFixture();
    const link = result.links.find(
      (l) => l.source.endsWith('plain.md') && l.target.endsWith('other.md'),
    );
    ok(link, 'expected the plain-file link to resolve');
    strictEqual(link.location?.line, 2, 'no frontmatter, body line 2 IS file line 2');
  });
});
