import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { schemaViolationAnalyzer } from '../index.js';
import type { Link, Node } from '../../../../../kernel/types.js';
import { SILENT_EXTENSION_LOGGER } from '../../../../../kernel/adapters/silent-logger.js';

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
    const issues = await schemaViolationAnalyzer.evaluate!({ nodes: [], links: [], settings: {}, log: SILENT_EXTENSION_LOGGER, emitContribution: noopEmit });
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
    const issues = await schemaViolationAnalyzer.evaluate!({ nodes: [node], links: [link], settings: {}, log: SILENT_EXTENSION_LOGGER, emitContribution: noopEmit });
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
    const issues = await schemaViolationAnalyzer.evaluate!({ nodes: [], links: [bad], settings: {}, log: SILENT_EXTENSION_LOGGER, emitContribution: noopEmit });
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
    const issues = await schemaViolationAnalyzer.evaluate!({ nodes: [bad], links: [], settings: {}, log: SILENT_EXTENSION_LOGGER, emitContribution: noopEmit });
    ok(issues.length >= 1);
    strictEqual(issues[0]?.analyzerId, 'schema-violation');
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
    // Missing `provider` → fails `node.schema.json` so the analyzer emits a
    // finding. This rule validates structural shape; per-kind frontmatter
    // requiredness (name/description) is the kernel's job, not re-checked here.
    const broken = {
      path: 'agents/broken.md',
      kind: 'agent',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 5, body: 0, total: 5 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    } as unknown as Node;
    await schemaViolationAnalyzer.evaluate!({ nodes: [broken], links: [], settings: {}, log: SILENT_EXTENSION_LOGGER, emitContribution: emit });
    strictEqual(log.length, 0, 'analyzer must not emit any contribution');
  });

  it('still produces issues that downstream aggregators consume', async () => {
    // Missing `provider` → fails `node.schema.json` so the analyzer emits a
    // finding. This rule validates structural shape; per-kind frontmatter
    // requiredness (name/description) is the kernel's job, not re-checked here.
    const broken = {
      path: 'agents/broken.md',
      kind: 'agent',
      bodyHash: 'a'.repeat(64),
      frontmatterHash: 'b'.repeat(64),
      bytes: { frontmatter: 5, body: 0, total: 5 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    } as unknown as Node;
    const issues = await schemaViolationAnalyzer.evaluate!({
      log: SILENT_EXTENSION_LOGGER,
      nodes: [broken],
      links: [],
      settings: {},
      emitContribution: () => {},
    });
    ok(issues.length >= 1, 'analyzer keeps emitting issue records');
  });
});
