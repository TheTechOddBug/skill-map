import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { schemaViolationAnalyzer } from '../index.js';
import type { Link, Node } from '../../../../../kernel/types.js';

/** Stub for tests that don't exercise the contribution emit channel. */
function noopEmit(): void {
  // no-op
}

function validNode(): Node {
  return {
    path: 'agents/ok.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 10, body: 100, total: 110 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {
      name: 'ok-agent',
      description: 'An agent',
      metadata: { version: '1.0.0' },
    },
  };
}

describe('validate-all rule', () => {
  it('emits no issues on an empty graph', async () => {
    const issues = await schemaViolationAnalyzer.evaluate({ nodes: [], links: [], emitContribution: noopEmit });
    strictEqual(issues.length, 0);
  });

  it('emits no issues on a graph with a well-formed node + link', async () => {
    const node = validNode();
    const link: Link = {
      source: 'agents/ok.md',
      target: 'agents/ok2.md',
      kind: 'references',
      confidence: 0.9,
      sources: ['annotations'],
    };
    const issues = await schemaViolationAnalyzer.evaluate({ nodes: [node], links: [link], emitContribution: noopEmit });
    strictEqual(issues.length, 0);
  });

  it('emits an error issue when a link has an invalid kind', async () => {
    const bad: Link = {
      source: 'a.md',
      target: 'b.md',
      // @ts-expect-error deliberately invalid kind
      kind: 'nonsense',
      confidence: 0.9,
      sources: ['x'],
    };
    const issues = await schemaViolationAnalyzer.evaluate({ nodes: [], links: [bad], emitContribution: noopEmit });
    strictEqual(issues.length, 1);
    strictEqual(issues[0]?.severity, 'error');
    strictEqual(issues[0]?.analyzerId, 'schema-violation');
    ok(issues[0]?.message.includes('nonsense') || issues[0]?.message.includes('Link'));
  });

  it('emits an issue per malformed node', async () => {
    // A node missing the required `provider` field (the schema mandates it
    // post-Phase-2b). The exact `as unknown as Node` cast is the test's
    // shortcut for "skip the type system; we want to feed bad data".
    const bad = {
      path: 'oops.md',
      kind: 'agent',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
    } as unknown as Node;
    const issues = await schemaViolationAnalyzer.evaluate({ nodes: [bad], links: [], emitContribution: noopEmit });
    ok(issues.length >= 1);
    strictEqual(issues[0]?.analyzerId, 'schema-violation');
  });
});

/**
 * Frontmatter base check. The node schema itself permits `frontmatter:
 * {}` because the per-kind schemas enforce required fields elsewhere;
 * when YAML parsing fails or the kernel dispatch can't reach the
 * per-kind validator, the orchestrator hands `schema-violation` a node
 * with a blank frontmatter. The analyzer catches that case so the
 * operator gets the same red-alert affordance as for `reference-broken`.
 */
describe('validate-all rule, frontmatter base check', () => {
  function nodeWith(frontmatter: Record<string, unknown>): Node {
    return {
      path: 'agents/broken.md',
      kind: 'agent',
      provider: 'claude',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 10, body: 100, total: 110 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter,
    };
  }

  it('flags a node whose frontmatter has no `name`', async () => {
    const node = nodeWith({ description: 'desc only' });
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [node],
      links: [],
      emitContribution: noopEmit,
    });
    const base = issues.find((i) => i.data?.['target'] === 'frontmatter');
    ok(base, 'expected a `target: frontmatter` finding');
    ok(base!.message.includes('name'), 'message names the missing field');
    ok(!base!.message.includes('description'), 'message does NOT mention present field');
  });

  it('flags a node whose frontmatter has no `description`', async () => {
    const node = nodeWith({ name: 'only-name' });
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [node],
      links: [],
      emitContribution: noopEmit,
    });
    const base = issues.find((i) => i.data?.['target'] === 'frontmatter');
    ok(base);
    ok(base!.message.includes('description'));
  });

  it('lists BOTH missing fields when frontmatter is fully blank', async () => {
    const node = nodeWith({});
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [node],
      links: [],
      emitContribution: noopEmit,
    });
    const base = issues.find((i) => i.data?.['target'] === 'frontmatter');
    ok(base);
    ok(base!.message.includes('name'));
    ok(base!.message.includes('description'));
  });

  it('does NOT flag a node whose name/description are present non-empty strings', async () => {
    const node = nodeWith({ name: 'ok', description: 'ok' });
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [node],
      links: [],
      emitContribution: noopEmit,
    });
    const base = issues.find((i) => i.data?.['target'] === 'frontmatter');
    strictEqual(base, undefined);
  });

  it('treats empty strings as missing', async () => {
    const node = nodeWith({ name: '', description: '' });
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [node],
      links: [],
      emitContribution: noopEmit,
    });
    const base = issues.find((i) => i.data?.['target'] === 'frontmatter');
    ok(base);
  });
});

describe('validate-all rule, contribution surface', () => {
  it('emits no view contributions (chip ownership moved to `core/issue-counter`)', async () => {
    interface IEmittedContribution {
      nodePath: string;
      ref: unknown;
      payload: unknown;
    }
    const log: IEmittedContribution[] = [];
    const emit = (nodePath: string, ref: unknown, payload: unknown): void => {
      log.push({ nodePath, ref, payload });
    };
    const broken = {
      path: 'agents/broken.md',
      kind: 'agent',
      provider: 'claude',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 5, body: 0, total: 5 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    } as Node;
    await schemaViolationAnalyzer.evaluate({ nodes: [broken], links: [], emitContribution: emit });
    strictEqual(log.length, 0, 'analyzer must not emit any contribution');
  });

  it('still produces issues that downstream aggregators consume', async () => {
    const broken = {
      path: 'agents/broken.md',
      kind: 'agent',
      provider: 'claude',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 5, body: 0, total: 5 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    } as Node;
    const issues = await schemaViolationAnalyzer.evaluate({
      nodes: [broken],
      links: [],
      emitContribution: () => {},
    });
    ok(issues.length >= 1, 'analyzer keeps emitting issue records');
  });
});

// Silence unused-imports left over from the removed view-contribution
// suite; the imports stay so the surviving tests in this file see the
// same surface they always did.
void ok;
