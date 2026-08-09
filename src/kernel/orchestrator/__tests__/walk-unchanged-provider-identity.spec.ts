/**
 * Provider identity on the incremental `unchanged` fast path
 * (`walkAndExtract` → `handleUnchangedRawNode`, kernel
 * `src/kernel/orchestrator/walk.ts`).
 *
 * No Provider declares `roots`, so every Provider's walk yields every
 * `.md` and `classify` is what disclaims a file outside its territory.
 * The mtime fast path has no freshly-parsed frontmatter to classify
 * with, so it reuses the prior node's kind, and it MUST reuse the prior
 * node's PROVIDER for the same reason: binding the node to whichever
 * Provider's pass reached it first let the first active (lens) Provider
 * claim every unchanged node. Observable damage, all from the same
 * mis-pairing: `(provider, kind)` no longer resolves to a declared
 * per-kind schema, so the next re-extraction of that node emitted a
 * spurious `frontmatter-invalid: no-schema`, and the persisted
 * `node.provider` (UI chip, next scan's bookkeeping) named a Provider
 * that had disclaimed the file.
 *
 * Regression fixture: a plain `notes/random.md` owned by the universal
 * `markdown` Provider, re-scanned under an active `claude` lens with a
 * cache miss forced on every extractor (the shape a `.sm` sidecar edit
 * produces: mtime unchanged, extraction re-run).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkAndExtract, type IWalkAndExtractResult } from '../walk.js';
import { indexPriorSnapshot } from '../cache.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import { buildProviderFrontmatterValidator } from '../../adapters/schema-validators.js';
import type { IExtractor, IProvider } from '../../extensions/index.js';
import type { ScanResult } from '../../types.js';

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-walk-provider-identity-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  write('.claude/agents/foo.md', ['---', 'name: foo', 'description: D', '---', 'B.'].join('\n'));
  write('notes/random.md', '# random\n');
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Stub Provider declaring exactly ONE kind, so a node bound to the
 * wrong Provider produces the `no-schema` verdict the regression rode.
 */
function stubProvider(over: {
  id: string;
  kind: string;
  gatedByActiveLens: boolean;
  claims: (path: string) => boolean;
}): IProvider {
  return {
    id: over.id,
    pluginId: over.id,
    kind: 'provider',
    version: '1.0.0',
    description: 'stub provider',
    presentation: { label: over.id, color: '#000000' },
    read: { extensions: ['.md'], parser: 'frontmatter-yaml' },
    gatedByActiveLens: over.gatedByActiveLens,
    kinds: {
      [over.kind]: {
        schema: 'inline',
        schemaJson: { type: 'object' },
        ui: { label: over.kind, color: '#000000' },
      },
    },
    classify: (path: string): string | null => (over.claims(path) ? over.kind : null),
  } as IProvider;
}

/** Gated lens Provider, iterated FIRST (the historical thief). */
const claudeStub = stubProvider({
  id: 'claude',
  kind: 'agent',
  gatedByActiveLens: true,
  claims: (p) => p.startsWith('.claude/'),
});

/** Universal fallback, iterated LAST, owns plain markdown. */
const markdownStub = stubProvider({
  id: 'markdown',
  kind: 'markdown',
  gatedByActiveLens: false,
  claims: () => true,
});

const PROVIDERS = [claudeStub, markdownStub];

/** Trivial extractor: its presence forces a re-extraction pass. */
const noopExtractor = {
  id: 'noop',
  pluginId: 'test',
  kind: 'extractor',
  version: '1.0.0',
  description: 'stub extractor',
  extract: () => [],
} as unknown as IExtractor;

async function runWalk(opts: {
  prior: ScanResult | null;
  extractors: IExtractor[];
}): Promise<IWalkAndExtractResult> {
  return walkAndExtract({
    providers: PROVIDERS,
    extractors: opts.extractors,
    roots: [fixture],
    emitter: new InMemoryProgressEmitter(),
    encoder: null,
    strict: false,
    enableCache: opts.prior !== null,
    tokenizerChanged: false,
    prior: opts.prior,
    priorIndex: indexPriorSnapshot(opts.prior),
    // Empty (not undefined) so the fine-grained path runs with NO
    // cached extractor run: every node re-extracts while its mtime
    // still matches, the exact shape a `.sm` sidecar edit produces.
    priorExtractorRuns: opts.prior === null ? undefined : new Map(),
    providerFrontmatter: buildProviderFrontmatterValidator(PROVIDERS),
    pluginStores: undefined,
    activeProvider: 'claude',
    scanCeiling: 100000,
    overrideScanCeiling: null,
    maxRenderNodes: 256,
    overrideMaxRenderNodes: null,
  });
}

/** Minimal prior snapshot: only what the walk's cache path reads. */
function asPrior(result: IWalkAndExtractResult): ScanResult {
  return { nodes: result.nodes, links: result.internalLinks, issues: [] } as unknown as ScanResult;
}

describe('walkAndExtract / unchanged fast path keeps the prior provider', () => {
  it('re-extracts an unchanged node under its OWN provider, not the active lens', async () => {
    const cold = await runWalk({ prior: null, extractors: [] });
    assert.deepEqual(
      cold.nodes.map((n) => `${n.provider}/${n.kind}`).sort(),
      ['claude/agent', 'markdown/markdown'],
    );

    const incremental = await runWalk({ prior: asPrior(cold), extractors: [noopExtractor] });
    const random = incremental.nodes.find((n) => n.path === 'notes/random.md');
    assert.equal(random?.provider, 'markdown', 'the universal owner keeps the node');
    assert.equal(random?.kind, 'markdown');
    const agent = incremental.nodes.find((n) => n.path === '.claude/agents/foo.md');
    assert.equal(agent?.provider, 'claude');
    assert.equal(agent?.kind, 'agent');
  });

  it('emits no frontmatter-invalid: the (provider, kind) pair still has a schema', async () => {
    const cold = await runWalk({ prior: null, extractors: [] });
    assert.deepEqual(cold.frontmatterIssues, []);

    const incremental = await runWalk({ prior: asPrior(cold), extractors: [noopExtractor] });
    assert.deepEqual(
      incremental.frontmatterIssues.map((i) => `${i.analyzerId}:${String(i.data?.['errors'])}`),
      [],
      'a mis-bound provider would surface as frontmatter-invalid: no-schema',
    );
  });
});
