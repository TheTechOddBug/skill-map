/**
 * Regression test for the wiring gap that let Mode A ship dead: the
 * kernel declared `RunScanOptions.pluginStores` and the orchestrator
 * read it, but NO production caller ever populated it, so
 * `ctx.store` was `undefined` on every real scan no matter what the
 * plugin's `plugin.json` declared.
 *
 * This suite drives the real `runScanForCommand` against a temp
 * project and asserts the whole chain end to end:
 *
 *   plugin manifest (`storage: { mode: 'kv' }`)
 *     → `buildPluginStores` (core/runtime/plugin-stores.ts)
 *     → `RunScanOptions.pluginStores`
 *     → `IExtractorContext.store` inside a running extractor
 *     → rows in `state_plugin_kvs` on the project DB.
 *
 * The plugin runtime is injected via `IScanRunOpts.pluginRuntime` (the
 * same seam the BFF uses) so the test exercises the wiring rather than
 * the on-disk discovery + trust machinery, which has its own suites.
 *
 * Coverage:
 *   - an extractor whose plugin declared KV storage receives a working
 *     `ctx.store` and its writes land in the DB;
 *   - values written on a previous scan are readable on the next one
 *     (the point of persistence);
 *   - a plugin that declared NO storage still sees `ctx.store` as
 *     `undefined`;
 *   - two plugins in the same scan cannot read each other's rows.
 */

import { after, before, describe, it } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runScanForCommand } from '../scan-runner.js';
import { createPrinter } from '../printer.js';
import type { IScanRunOpts } from '../scan-runner.js';
import type { IPluginRuntime } from '../plugin-runtime.js';
import type { IExtractor } from '../../../kernel/extensions/index.js';
import type { IKvStoreWrapper } from '../../../kernel/index.js';
import type { IDiscoveredPlugin } from '../../../kernel/ports/plugin-loader.js';
import { SqliteStorageAdapter } from '../../../kernel/adapters/sqlite/index.js';
import { defaultProjectDbPath } from '../../paths/db-path.js';

let projectRoot: string;

/** Discards every channel; the runner requires a printer. */
const silentPrinter = createPrinter({
  stdout: { write: () => true } as unknown as NodeJS.WritableStream,
  stderr: { write: () => true } as unknown as NodeJS.WritableStream,
});

const silentStderr = { write: () => true } as unknown as NodeJS.WritableStream;

before(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-map-store-wiring-'));
  const skill = join(projectRoot, '.claude', 'skills', 'probe');
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    join(skill, 'SKILL.md'),
    ['---', 'name: probe', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** A discovered-plugin record shaped the way the loader emits one. */
function discoveredPlugin(id: string, withStorage: boolean): IDiscoveredPlugin {
  return {
    path: join(projectRoot, '.skill-map', 'plugins', id),
    id,
    status: 'enabled',
    manifest: {
      version: '1.0.0',
      description: 'test plugin',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
      ...(withStorage ? { storage: { mode: 'kv' as const } } : {}),
    },
  };
}

/** Synthetic runtime carrying only the probe extractors under test. */
function pluginRuntimeWith(
  extractors: IExtractor[],
  discovered: IDiscoveredPlugin[],
): IPluginRuntime {
  return {
    extensions: {
      providers: [],
      extractors,
      analyzers: [],
      formatters: [],
      hooks: [],
      actions: [],
    },
    annotationContributions: [],
    viewContributions: [],
    manifests: [],
    warnings: [],
    discovered,
    resolveEnabled: () => true,
    emitWarnings: () => undefined,
  };
}

function scanOpts(runtime: IPluginRuntime): IScanRunOpts {
  return {
    // Explicit root: an empty list defaults to `'.'`, which the walker
    // resolves against the test process cwd (the repo), not the temp
    // project.
    roots: [projectRoot],
    noBuiltIns: false,
    noPlugins: false,
    noTokens: true,
    dryRun: false,
    changed: false,
    allowEmpty: true,
    strict: false,
    stderr: silentStderr,
    printer: silentPrinter,
    ctx: { cwd: projectRoot },
    pluginRuntime: runtime,
    yes: true,
    warnOnDrift: false,
  };
}

/** Read the persisted KV rows straight from the project DB. */
async function readKvRows(): Promise<
  { pluginId: string; nodeId: string; key: string; valueJson: string }[]
> {
  const adapter = new SqliteStorageAdapter({
    databasePath: defaultProjectDbPath({ cwd: projectRoot }),
    autoBackup: false,
  });
  await adapter.init();
  try {
    return await adapter.db
      .selectFrom('state_plugin_kvs')
      .select(['pluginId', 'nodeId', 'key', 'valueJson'])
      .orderBy('pluginId', 'asc')
      .orderBy('key', 'asc')
      .execute();
  } finally {
    await adapter.close();
  }
}

describe('sm scan wires ctx.store for plugins that declared KV storage', () => {
  it('an extractor reaches a live ctx.store and its writes reach state_plugin_kvs', async () => {
    const seen: unknown[] = [];
    const readBack: unknown[] = [];
    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'store-probe',
      pluginId: 'kv-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        seen.push(ctx.store);
        const store = ctx.store as IKvStoreWrapper;
        // Read whatever the previous scan left (null on the first run).
        readBack.push(await store.get('runs.last'));
        await store.set('runs.last', { path: ctx.node.path });
        await store.set('runs.node', { seenAt: 'node' }, { nodePath: ctx.node.path });
      },
    };

    const runtime = pluginRuntimeWith([extractor], [discoveredPlugin('kv-plugin', true)]);

    const first = await runScanForCommand(scanOpts(runtime));
    strictEqual(first.kind, 'ok', JSON.stringify(first));
    ok(seen[0] !== undefined, 'ctx.store must be populated on a real scan');
    ok(
      typeof (seen[0] as IKvStoreWrapper).get === 'function' &&
        typeof (seen[0] as IKvStoreWrapper).list === 'function',
      'ctx.store must expose the full four-method KvStore surface',
    );
    strictEqual(readBack[0], null, 'nothing stored before the first scan');

    const rows = await readKvRows();
    deepStrictEqual(
      rows.map((r) => `${r.pluginId}|${r.nodeId}|${r.key}`),
      [
        'kv-plugin||runs.last',
        'kv-plugin|.claude/skills/probe/SKILL.md|runs.node',
      ],
      'global row uses the empty node_id sentinel, node row carries the path',
    );
    deepStrictEqual(JSON.parse(rows[0]!.valueJson), {
      path: '.claude/skills/probe/SKILL.md',
    });

    // Second scan: the value written by the first one is readable, which
    // is the whole point of persisting it.
    const second = await runScanForCommand(scanOpts(runtime));
    strictEqual(second.kind, 'ok');
    deepStrictEqual(
      readBack[1],
      { path: '.claude/skills/probe/SKILL.md' },
      'the prior scan value survived into the next scan',
    );
  });

  it('a plugin that declared no storage still sees ctx.store === undefined', async () => {
    const seen: unknown[] = [];
    const extractor: IExtractor = {
      kind: 'extractor',
      id: 'no-store-probe',
      pluginId: 'plain-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: (ctx): void => {
        seen.push(ctx.store);
      },
    };

    const runtime = pluginRuntimeWith(
      [extractor],
      [discoveredPlugin('plain-plugin', false)],
    );
    const result = await runScanForCommand(scanOpts(runtime));
    strictEqual(result.kind, 'ok');
    strictEqual(seen.length, 1);
    strictEqual(seen[0], undefined);
  });

  it('two KV plugins in one scan cannot read each other rows', async () => {
    const readByA: unknown[] = [];
    const readByB: unknown[] = [];
    const probe = (
      pluginId: string,
      value: string,
      sink: unknown[],
    ): IExtractor => ({
      kind: 'extractor',
      id: 'isolation-probe',
      pluginId,
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: async (ctx): Promise<void> => {
        const store = ctx.store as IKvStoreWrapper;
        await store.set('owner', value);
        sink.push(await store.get('owner'));
      },
    });

    const runtime = pluginRuntimeWith(
      [probe('iso-a', 'from-a', readByA), probe('iso-b', 'from-b', readByB)],
      [discoveredPlugin('iso-a', true), discoveredPlugin('iso-b', true)],
    );
    const result = await runScanForCommand(scanOpts(runtime));
    strictEqual(result.kind, 'ok');

    deepStrictEqual(readByA, ['from-a']);
    deepStrictEqual(readByB, ['from-b']);

    const rows = (await readKvRows()).filter((r) => r.key === 'owner');
    deepStrictEqual(
      rows.map((r) => `${r.pluginId}=${JSON.parse(r.valueJson) as string}`),
      ['iso-a=from-a', 'iso-b=from-b'],
      'each plugin owns its own row under the same key',
    );
  });
});
