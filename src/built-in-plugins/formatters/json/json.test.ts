/**
 * `json` formatter, unit-level coverage of the projection contract:
 *
 *   - When `ctx.scanResult` is present, the formatter stringifies it
 *     verbatim (byte-equivalent to `sm scan --json` modulo whitespace).
 *   - When `ctx.scanResult` is absent (legacy three-array drivers), the
 *     formatter falls back to a minimal `{ nodes, links, issues }`
 *     envelope without fabricating `schemaVersion` / `scannedAt`.
 *
 * Full ScanResult schema conformance is exercised end-to-end via
 * `cli-json-envelopes.test.ts` (`sm graph --format json` over a primed
 * project).
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { jsonFormatter } from './index.js';
import type { Issue, Link, Node, ScanResult } from '../../../kernel/types.js';

function buildNode(path: string): Node {
  return {
    path,
    kind: 'agent',
    provider: 'claude',
    bodyHash: 'b'.repeat(64),
    frontmatterHash: 'f'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    frontmatter: {},
  };
}

describe('json formatter', () => {
  it('emits the full ScanResult verbatim when ctx.scanResult is supplied', () => {
    const node = buildNode('a.md');
    const link: Link = {
      source: 'a.md',
      target: 'b.md',
      kind: 'references',
      confidence: 'high',
      sources: ['annotations'],
    };
    const issue: Issue = {
      analyzerId: 'broken-ref',
      severity: 'warn',
      nodeIds: ['a.md'],
      message: 'broken',
    };
    const scanResult: ScanResult = {
      schemaVersion: 1,
      scannedAt: 1700000000000,
      roots: ['.'],
      providers: ['claude'],
      nodes: [node],
      links: [link],
      issues: [issue],
      stats: {
        filesWalked: 1,
        filesSkipped: 0,
        nodesCount: 1,
        linksCount: 1,
        issuesCount: 1,
        durationMs: 12,
      },
    };

    const out = jsonFormatter.format({
      nodes: scanResult.nodes,
      links: scanResult.links,
      issues: scanResult.issues,
      scanResult,
    });
    const parsed = JSON.parse(out) as ScanResult;
    deepStrictEqual(parsed, scanResult);
  });

  it('falls back to a partial envelope when ctx.scanResult is absent', () => {
    const node = buildNode('a.md');
    const out = jsonFormatter.format({
      nodes: [node],
      links: [],
      issues: [],
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    ok(Array.isArray(parsed['nodes']));
    strictEqual((parsed['nodes'] as unknown[]).length, 1);
    ok(Array.isArray(parsed['links']));
    ok(Array.isArray(parsed['issues']));
    // Fallback intentionally drops top-level metadata; the formatter
    // does not fabricate `schemaVersion` / `scannedAt` / `stats`.
    strictEqual(parsed['schemaVersion'], undefined);
    strictEqual(parsed['scannedAt'], undefined);
  });
});
