/**
 * Plugin-load warnings are emitted EXACTLY ONCE per `sm serve` boot.
 *
 * The composition root (`server/index.ts`) is the single emission point:
 * the watcher never re-surfaces them (it is always handed the boot-cached
 * runtime, and `resolveBootPluginRuntime` deliberately skips
 * `onPluginWarning` for an injected one), and no route factory may emit
 * at registration time.
 *
 * Regression: two route factories (`node-prob-extensions`, `node-jobs`)
 * each emitted the whole `pluginRuntime.warnings` list when they
 * registered, both believing they were the only one, while the
 * composition root had gated its own emission behind `--no-watcher`. A
 * bare `sm` over a project carrying one untrusted drop-in printed the
 * "found but not loaded (untrusted)" notice twice, and `--no-watcher`
 * printed it three times.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { configureLogger, resetLogger } from '../../kernel/util/logger.js';
import type { LoggerPort } from '../../kernel/ports/logger.js';
import { createServer, type IServerOptions } from '../index.js';

let tmpRoot: string;
let counter = 0;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-plugin-warn-once-'));
});

after(() => {
  resetLogger();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * A project carrying one project-local plugin that is never trusted, the
 * clone-and-scan shape: discovered on disk, code never imported, one
 * aggregate notice on the server log.
 */
function fixtureWithUntrustedPlugin(): string {
  counter += 1;
  const root = join(tmpRoot, `project-${counter}`);
  const pluginDir = join(root, '.skill-map', 'plugins', `fixture-untrusted-${counter}`);
  const extDir = join(pluginDir, 'extractors', `fixture-untrusted-${counter}-extractor`);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      description: 'warning-count fixture',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    }),
  );
  writeFileSync(
    join(extDir, 'extension.json'),
    JSON.stringify({ version: '0.1.0', description: 'fixture extension' }),
  );
  writeFileSync(join(extDir, 'index.mjs'), 'export default { extract() {} };\n');
  return root;
}

/** Collect every `log.warn` line for the duration of one boot. */
function captureWarnings(): { lines: string[]; install: () => void } {
  const lines: string[] = [];
  const logger: LoggerPort = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      lines.push(message);
    },
    error: () => undefined,
  };
  return { lines, install: () => configureLogger(logger) };
}

function serverOptions(root: string, noWatcher: boolean): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: join(root, '.skill-map', 'skill-map.db'),
    uiDist: null,
    noUi: true,
    noBuiltIns: false,
    noPlugins: false,
    open: false,
    devCors: false,
    noWatcher,
    mcpServer: false,
    settingsEnv: {},
  };
}

/** Boot, count the untrusted notices, shut down. */
async function countUntrustedNotices(noWatcher: boolean): Promise<number> {
  const root = fixtureWithUntrustedPlugin();
  const capture = captureWarnings();
  capture.install();
  const handle = await createServer(serverOptions(root, noWatcher), {
    runtimeContext: { cwd: root },
  });
  try {
    return capture.lines.filter((line) => line.includes('but not loaded (untrusted)')).length;
  } finally {
    await handle.close();
    resetLogger();
  }
}

describe('plugin-load warnings at sm serve boot', () => {
  it('emits the untrusted-plugin notice exactly once with the watcher on', async () => {
    assert.equal(await countUntrustedNotices(false), 1);
  });

  it('emits the untrusted-plugin notice exactly once with --no-watcher', async () => {
    assert.equal(await countUntrustedNotices(true), 1);
  });
});
