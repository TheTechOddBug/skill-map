import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import { externalUrlCounterExtractor } from '../index.js';
import type { IExtractorContext, IEmittedNode } from '../../../../../kernel/extensions/index.js';
import type { Node, Signal } from '../../../../../kernel/types.js';

function mockNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: '0'.repeat(64),
    frontmatterHash: '0'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
  };
}

function makeContext(node: Node, body: string, settings: Record<string, unknown> = {}): {
  ctx: IExtractorContext;
  signals: Signal[];
  contributions: Array<{ payload: unknown }>;
} {
  const signals: Signal[] = [];
  const contributions: Array<{ payload: unknown }> = [];
  const virtualNodes: IEmittedNode[] = [];
  const ctx: IExtractorContext = {
    node,
    body,
    frontmatter: node.frontmatter ?? {},
    settings,
    emitLink: () => undefined,
    enrichNode: () => undefined,
    emitContribution: (_contribution, payload) => contributions.push({ payload }),
    emitSignal: (s) => signals.push(s),
    emitNode: (n) => virtualNodes.push(n),
  };
  return { ctx, signals, contributions };
}

/**
 * The external-url-counter emits pseudo-link Signals that the orchestrator
 * counts then drops, so the unit assertions target the emitted Signals and
 * the footer-count contribution directly rather than resolved Links.
 */
function run(body: string, settings: Record<string, unknown> = {}): ReturnType<typeof makeContext> {
  const helper = makeContext(mockNode('docs/x.md'), body, settings);
  externalUrlCounterExtractor.extract(helper.ctx);
  return helper;
}

describe('external-url-counter extractor', () => {
  it('emits one references pseudo-link signal per distinct URL', () => {
    const h = run('see https://example.com/a and http://other.org/b');
    strictEqual(h.signals.length, 2);
    const targets = h.signals.map((s) => s.candidates[0]!.target).sort();
    deepStrictEqual(targets, ['http://other.org/b', 'https://example.com/a']);
    for (const s of h.signals) {
      strictEqual(s.scope, 'body');
      strictEqual(s.candidates[0]!.kind, 'references');
      strictEqual(s.candidates[0]!.confidence, 0.3);
    }
  });

  it('lowercases the host and drops the fragment when normalizing', () => {
    const h = run('https://EXAMPLE.com/Path#frag');
    strictEqual(h.signals.length, 1);
    strictEqual(h.signals[0]!.candidates[0]!.target, 'https://example.com/Path');
  });

  it('counts two fragments of the same URL as one external ref', () => {
    const h = run('https://example.com/p#a then https://example.com/p#b');
    strictEqual(h.signals.length, 1);
  });

  it('trims trailing sentence punctuation', () => {
    const h = run('visit https://example.com/a.');
    strictEqual(h.signals[0]!.candidates[0]!.target, 'https://example.com/a');
  });

  it('emits a footer contribution carrying the distinct-URL count', () => {
    const h = run('https://a.com and https://b.com and https://a.com');
    strictEqual(h.signals.length, 2);
    strictEqual(h.contributions.length, 1);
    deepStrictEqual(h.contributions[0]!.payload, { value: 2 });
  });

  it('skips URLs inside code spans and fenced blocks', () => {
    const h = run('inline `https://x.com` and:\n```\nhttps://y.com\n```\n');
    strictEqual(h.signals.length, 0);
    strictEqual(h.contributions.length, 0);
  });

  it('is silent on a body with no URLs', () => {
    const h = run('no links here, just prose');
    strictEqual(h.signals.length, 0);
    strictEqual(h.contributions.length, 0);
  });

  it('declares an `ignored-domains` string-list setting', () => {
    const declared = externalUrlCounterExtractor.settings ?? {};
    const setting = declared['ignored-domains'];
    strictEqual(setting?.type, 'string-list');
    deepStrictEqual(setting && 'default' in setting ? setting.default : undefined, []);
  });

  describe('ignored-domains setting', () => {
    const body = 'see https://example.com/a and http://other.org/b and https://keep.me/c';

    it('counts every domain when the ignore list is empty', () => {
      const h = run(body, { 'ignored-domains': [] });
      strictEqual(h.signals.length, 3);
      deepStrictEqual(h.contributions[0]!.payload, { value: 3 });
    });

    it('skips a listed domain: no Signal, lower chip count', () => {
      const h = run(body, { 'ignored-domains': ['example.com'] });
      strictEqual(h.signals.length, 2);
      const targets = h.signals.map((s) => s.candidates[0]!.target).sort();
      deepStrictEqual(targets, ['http://other.org/b', 'https://keep.me/c']);
      deepStrictEqual(h.contributions[0]!.payload, { value: 2 });
    });

    it('matches the hostname case-insensitively', () => {
      const h = run('https://EXAMPLE.com/a and https://keep.me/c', { 'ignored-domains': ['Example.COM'] });
      strictEqual(h.signals.length, 1);
      strictEqual(h.signals[0]!.candidates[0]!.target, 'https://keep.me/c');
    });

    it('drops the chip entirely when every URL is ignored', () => {
      const h = run('https://example.com/a and https://example.com/b', { 'ignored-domains': ['example.com'] });
      strictEqual(h.signals.length, 0);
      strictEqual(h.contributions.length, 0);
    });

    it('ignores a non-array setting value (degrades to counting all)', () => {
      const h = run(body, { 'ignored-domains': 'not-an-array' });
      strictEqual(h.signals.length, 3);
    });
  });
});
