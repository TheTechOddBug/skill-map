/**
 * Spec § A.12 acceptance, `IExtractorContext.store` wiring.
 *
 * The orchestrator looks up the per-plugin storage wrapper from
 * `RunScanOptions.pluginStores` (keyed by `pluginId`) and attaches it
 * to the context handed to each extractor. These tests pin:
 *
 *   (a) `pluginStores` absent → `ctx.store` is `undefined` for every
 *       extractor (the legacy contract for plugins without storage).
 *   (b) `pluginStores` with an entry for the extractor's `pluginId` →
 *       `ctx.store` IS that wrapper. The extractor can call its
 *       methods and writes flow into the supplied persist callback.
 *   (c) Multiple plugins, multiple stores → each extractor gets the
 *       wrapper keyed by its own `pluginId` (no cross-plugin leakage).
 *   (d) `runExtractorsForNode` (the refresh path) honours the same
 *       wiring as the in-scan path.
 *
 * The probe extractors capture `ctx.store` and any persist calls
 * synchronously into per-test arrays; tests assert against those
 * arrays after the scan completes.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InMemoryProgressEmitter,
  createKernel,
  makeKvStoreWrapper,
  runExtractorsForNode,
  runScan,
} from '../../index.js';
import type {
  TPluginStore,
  IKvPersistedRow,
  IKvStorePersist,
  IKvStoreWrapper,
} from '../../index.js';
import { builtIns } from '../../../plugins/built-ins.js';
import type { IExtractor } from '../../extensions/index.js';
import type { Node } from '../../types.js';

/**
 * Minimal in-memory `IKvStorePersist` double. These tests only care
 * that a write reached persistence, so `sink` records every `set` with
 * the value already decoded (the wrapper hands persistence an encoded
 * JSON string). `get` / `list` / `delete` read back the same map so the
 * double stays a faithful stand-in if a probe ever exercises them.
 */
function capturingPersist(
  sink: Array<{ key: string; value: unknown }>,
): IKvStorePersist {
  const rows = new Map<string, IKvPersistedRow>();
  const id = (nodeId: string, key: string): string => `${nodeId}\u0000${key}`;
  return {
    get: (nodeId, key) => rows.get(id(nodeId, key)) ?? null,
    set: (nodeId, key, valueJson, updatedAt) => {
      rows.set(id(nodeId, key), { nodeId, key, valueJson, updatedAt });
      sink.push({ key, value: JSON.parse(valueJson) });
    },
    delete: (nodeId, key) => rows.delete(id(nodeId, key)),
    list: (nodeId) => [...rows.values()].filter((row) => row.nodeId === nodeId),
  };
}

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-ctx-store-'));
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  // Single skill node, the per-extractor wiring is what's under test;
  // any provider-classified file is sufficient.
  write(
    '.claude/skills/probe/SKILL.md',
    ['---', 'name: probe', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Probe extractor that captures `ctx.store` for the kind under test.
 * `pluginId` is parameterised so a single test can register two probes
 * from two different plugin namespaces and assert each one sees its
 * own wrapper.
 */
function buildProbe(
  pluginId: string,
): { extractor: IExtractor; seen: Array<{ pluginId: string; store: unknown }> } {
  const seen: Array<{ pluginId: string; store: unknown }> = [];
  const extractor: IExtractor = {
    kind: 'extractor',
    id: 'store-probe',
    pluginId,
    version: '1.0.0',
    description: 'test',
    scope: 'body',
    extract: (ctx): void => {
      seen.push({ pluginId, store: ctx.store });
    },
  };
  return { extractor, seen };
}

describe('IExtractorContext.store wiring (spec § A.12)', () => {
  it('(a) pluginStores absent → ctx.store stays undefined', async () => {
    const { extractor, seen } = buildProbe('test-plugin');
    const kernel = createKernel();
    const baseline = builtIns();
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        analyzers: [],
      },
    });
    strictEqual(seen.length, 1);
    strictEqual(seen[0]?.store, undefined);
  });

  it('(b) pluginStores entry matches pluginId → ctx.store is that wrapper, persist captures writes', async () => {
    const persisted: Array<{ key: string; value: unknown }> = [];
    const wrapper: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'test-plugin',
      schema: undefined,
      persist: capturingPersist(persisted),
    });

    const seen: Array<unknown> = [];
    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'store-probe',
      pluginId: 'test-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        seen.push(ctx.store);
        const store = ctx.store as IKvStoreWrapper;
        await store.set('first-seen', { path: ctx.node.path });
      },
    };

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, TPluginStore>([['test-plugin', wrapper]]);
    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [extractor],
        analyzers: [],
      },
      pluginStores,
    });

    strictEqual(seen.length, 1);
    strictEqual(seen[0], wrapper, 'ctx.store should be the exact wrapper instance keyed by pluginId');
    deepStrictEqual(persisted, [
      { key: 'first-seen', value: { path: '.claude/skills/probe/SKILL.md' } },
    ]);
  });

  it('(c) Multiple plugins → each extractor receives only its own wrapper', async () => {
    const wrapperA: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'plugin-a',
      schema: undefined,
      persist: capturingPersist([]),
    });
    const wrapperB: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'plugin-b',
      schema: undefined,
      persist: capturingPersist([]),
    });

    const probeA = buildProbe('plugin-a');
    const probeB = buildProbe('plugin-b');

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, TPluginStore>([
      ['plugin-a', wrapperA],
      ['plugin-b', wrapperB],
    ]);

    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [probeA.extractor, probeB.extractor],
        analyzers: [],
      },
      pluginStores,
    });

    strictEqual(probeA.seen.length, 1);
    strictEqual(probeA.seen[0]?.store, wrapperA);
    strictEqual(probeB.seen.length, 1);
    strictEqual(probeB.seen[0]?.store, wrapperB);
    // Cross-check: neither extractor saw the OTHER plugin's wrapper.
    ok(probeA.seen[0]?.store !== wrapperB);
    ok(probeB.seen[0]?.store !== wrapperA);
  });

  it('(c2) Plugin without an entry in pluginStores → ctx.store stays undefined for that one only', async () => {
    const wrapperA: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'plugin-a',
      schema: undefined,
      persist: capturingPersist([]),
    });

    const probeA = buildProbe('plugin-a');
    const probeOrphan = buildProbe('plugin-without-store');

    const kernel = createKernel();
    const baseline = builtIns();
    const pluginStores = new Map<string, TPluginStore>([['plugin-a', wrapperA]]);

    await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [probeA.extractor, probeOrphan.extractor],
        analyzers: [],
      },
      pluginStores,
    });

    strictEqual(probeA.seen[0]?.store, wrapperA);
    strictEqual(probeOrphan.seen[0]?.store, undefined);
  });

  it('(d) runExtractorsForNode honours pluginStores the same way', async () => {
    const persisted: Array<{ key: string; value: unknown }> = [];
    const wrapper: IKvStoreWrapper = makeKvStoreWrapper({
      pluginId: 'refresh-plugin',
      schema: undefined,
      persist: capturingPersist(persisted),
    });

    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'refresh-probe',
      pluginId: 'refresh-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        const store = ctx.store as IKvStoreWrapper;
        await store.set('via-refresh', { nodePath: ctx.node.path });
      },
    };

    const node: Node = {
      path: 'fake/node.md',
      kind: 'skill',
      provider: 'claude',
      bodyHash: 'hash-body',
      frontmatterHash: 'hash-fm',
      bytes: { frontmatter: 0, body: 0, total: 0 },
      linksOutCount: 0,
      linksInCount: 0,
      externalRefsCount: 0,
      frontmatter: {},
    };

    await runExtractorsForNode({
      extractors: [extractor],
      node,
      body: 'body',
      frontmatter: {},
      bodyHash: 'hash-body',
      emitter: new InMemoryProgressEmitter(),
      pluginStores: new Map<string, TPluginStore>([['refresh-plugin', wrapper]]),
    });

    deepStrictEqual(persisted, [
      { key: 'via-refresh', value: { nodePath: 'fake/node.md' } },
    ]);
  });
});
