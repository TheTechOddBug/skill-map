/**
 * Unit tests for the file-size skip in `walkAndExtract` (kernel,
 * `src/kernel/orchestrator/walk.ts`). The skip is driven by
 * `maxFileSizeBytes` (mirror of `scan.maxFileSizeBytes`).
 *
 * Behaviour pinned here:
 *
 *   - Files larger than the limit never become nodes; they are
 *     collected into `result.oversizedFiles` with their root-relative
 *     path + byte size.
 *   - `stats.filesOversized` equals `oversizedFiles.length` (asserted on
 *     the orchestrator side, `walk-content.spec.ts` pins the per-file
 *     callback contract).
 *   - When no `maxFileSizeBytes` is threaded, no file is skipped and
 *     `oversizedFiles` is empty.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkAndExtract } from '../walk.js';
import { runScan } from '../index.js';
import { createKernel } from '../../index.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import { buildProviderFrontmatterValidator } from '../../adapters/schema-validators.js';
import type { IProvider } from '../../extensions/index.js';

let fixture: string;
let bigBytes: number;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-walk-oversized-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  write('docs/small.md', ['---', 'name: small', '---', 'tiny'].join('\n'));
  const bigContent = ['---', 'name: big', '---', 'B'.repeat(8192)].join('\n');
  write('docs/big.md', bigContent);
  bigBytes = Buffer.byteLength(bigContent);
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function makeMarkdownProvider(): IProvider {
  return {
    id: 'markdown',
    pluginId: 'core',
    kind: 'provider',
    version: '1.0.0',
    description: 'test stub',
    presentation: { label: 'Markdown', color: '#000000' },
    read: { extensions: ['.md'], parser: 'frontmatter-yaml' },
    kinds: {
      note: {
        schema: 'inline',
        schemaJson: { type: 'object' },
        ui: { label: 'Note', color: '#000000' },
      },
    },
    classify(): string {
      return 'note';
    },
  };
}

async function runWalk(maxFileSizeBytes: number | undefined) {
  const providers = [makeMarkdownProvider()];
  return walkAndExtract({
    providers,
    extractors: [],
    roots: [fixture],
    emitter: new InMemoryProgressEmitter(),
    encoder: null,
    strict: false,
    enableCache: false,
    tokenizerChanged: false,
    prior: null,
    priorIndex: {
      priorNodesByPath: new Map(),
      priorNodePaths: new Set(),
      priorLinksByOriginating: new Map(),
      priorFrontmatterIssuesByNode: new Map(),
    },
    priorExtractorRuns: undefined,
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: null,
    recommendedNodeLimit: 256,
    overrideMaxNodes: null,
    ...(maxFileSizeBytes !== undefined ? { maxFileSizeBytes } : {}),
  });
}

describe('walkAndExtract / file-size skip', () => {
  it('collects files over the limit into oversizedFiles (path + bytes), keeps the small one', async () => {
    const out = await runWalk(1024);

    strictEqual(out.nodes.length, 1, 'only the under-limit file becomes a node');
    strictEqual(out.nodes[0]!.path, 'docs/small.md');
    deepStrictEqual(out.oversizedFiles, [{ path: 'docs/big.md', bytes: bigBytes }]);
  });

  it('applies no limit when maxFileSizeBytes is absent', async () => {
    const out = await runWalk(undefined);

    strictEqual(out.nodes.length, 2, 'both files become nodes without a limit');
    deepStrictEqual(out.oversizedFiles, []);
  });

  it('runScan surfaces oversizedFiles + stats.filesOversized on the ScanResult', async () => {
    const result = await runScan(createKernel(), {
      roots: [fixture],
      extensions: { providers: [makeMarkdownProvider()], extractors: [], analyzers: [] },
      tokenize: false,
      activeProvider: null,
      maxFileSizeBytes: 1024,
    });

    strictEqual(result.stats.nodesCount, 1);
    strictEqual(result.stats.filesOversized, 1);
    deepStrictEqual(result.oversizedFiles, [{ path: 'docs/big.md', bytes: bigBytes }]);
  });
});
