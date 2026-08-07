/**
 * `ICreateWatcherRuntimeOpts.pluginRuntime` injection seam (mirror of
 * `IScanRunOpts.pluginRuntime`, audit M3 extended to the watcher).
 *
 * Pins two contracts:
 *
 *   1. An injected runtime IS the one the watcher uses. The test sets
 *      `noPlugins: true`, which without injection resolves to the empty
 *      runtime; the injected probe extractor still running proves the
 *      injected bag won (documented "wins over noPlugins": the injector
 *      already resolved that flag when it built the runtime).
 *   2. Injected warnings are NOT re-forwarded through
 *      `events.onPluginWarning` (the injector surfaced them at its own
 *      boot; re-emitting would print every plugin warning twice on
 *      `sm serve`).
 *
 * Same deterministic initial-batch-only shape as
 * `runtime-batch-start.spec.ts`: `stop()` right after `start()`, no live
 * file-change loop (the watcher prohibition holds).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { InMemoryProgressEmitter } from '../../../kernel/adapters/in-memory-progress.js';
import type { IExtractor } from '../../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../../kernel/ports/plugin-loader.js';
import type { IPluginRuntime } from '../../runtime/plugin-runtime.js';
import type { IWatcherEvents } from '../runtime.js';
import { createWatcherRuntime } from '../runtime.js';

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-watcher-injected-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function buildInjectedRuntime(cwd: string, extractor: IExtractor): IPluginRuntime {
  const discovered: IDiscoveredPlugin = {
    path: join(cwd, '.skill-map', 'plugins', 'probe-plugin'),
    id: 'probe-plugin',
    status: 'enabled',
    manifest: {
      version: '1.0.0',
      description: 'test plugin',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    },
  };
  return {
    extensions: {
      providers: [],
      extractors: [extractor],
      analyzers: [],
      formatters: [],
      hooks: [],
      actions: [],
    },
    annotationContributions: [],
    viewContributions: [],
    manifests: [],
    warnings: ['synthetic warning already surfaced by the injector'],
    discovered: [discovered],
    resolveEnabled: () => true,
    emitWarnings: () => undefined,
  };
}

describe('createWatcherRuntime with an injected pluginRuntime', () => {
  it('uses the injected runtime and does not re-forward its warnings', async () => {
    const cwd = join(tmpRoot, 'injected');
    mkdirSync(join(cwd, '.skill-map'), { recursive: true });
    writeFileSync(join(cwd, 'note.md'), '# note\n\nbody\n');
    const dbPath = join(cwd, '.skill-map', 'graph.db');

    let probeRuns = 0;
    const probe: IExtractor = {
      kind: 'extractor',
      id: 'watcher-probe',
      pluginId: 'probe-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: async (): Promise<void> => {
        probeRuns += 1;
      },
    };

    const warnings: string[] = [];
    let batchOk = false;
    const events: IWatcherEvents = {
      onPluginWarning: (warn) => warnings.push(warn),
      onBatch: (outcome) => {
        if (outcome.kind === 'ok') batchOk = true;
      },
    };

    const runtime = createWatcherRuntime({
      dbPath,
      roots: [cwd], // absolute: the orchestrator resolves relative roots against process.cwd()
      runtimeContext: { cwd },
      noBuiltIns: false,
      // Without injection this resolves to the EMPTY runtime, so the
      // probe running below proves the injected bag was consumed.
      noPlugins: true,
      pluginRuntime: buildInjectedRuntime(cwd, probe),
      emitterFactory: () => new InMemoryProgressEmitter(),
      runInitialBatch: true,
      subscribeBeforeInitial: false,
      events,
    });

    try {
      await runtime.start();
    } finally {
      await runtime.stop();
    }

    assert.equal(batchOk, true, 'initial batch must complete');
    assert.ok(probeRuns > 0, 'the injected probe extractor must run in the initial batch');
    assert.deepEqual(
      warnings,
      [],
      'injected-runtime warnings were already surfaced by the injector and must not re-forward',
    );
  });
});
