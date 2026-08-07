/**
 * Behavior tests for the incremental-by-default scan (spec
 * `cli-contract.md` §Scan, 2026-08-07): `runScanForCommand` with no
 * mode flag reuses cached extractor runs when a persisted prior
 * snapshot exists, `full: true` bypasses the reuse, and
 * `changed: true` (the explicit alias) behaves exactly like the
 * default.
 *
 * The discriminating observable is a counting probe extractor injected
 * via `IScanRunOpts.pluginRuntime` (same seam as
 * `scan-runner-plugin-stores.spec.ts`): a cached `(node, extractor)`
 * pair does NOT invoke `extract()` again, so the counter freezes on
 * reuse and moves on re-extraction.
 */

import { after, before, describe, it } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runScanForCommand } from '../scan-runner.js';
import { createPrinter } from '../printer.js';
import type { IScanRunOpts } from '../scan-runner.js';
import type { IPluginRuntime } from '../plugin-runtime.js';
import type { IExtractor } from '../../../kernel/extensions/index.js';
import type { IDiscoveredPlugin } from '../../../kernel/ports/plugin-loader.js';

let projectRoot: string;

/** Discards every channel; the runner requires a printer. */
const silentPrinter = createPrinter({
  stdout: { write: () => true } as unknown as NodeJS.WritableStream,
  stderr: { write: () => true } as unknown as NodeJS.WritableStream,
});

const silentStderr = { write: () => true } as unknown as NodeJS.WritableStream;

before(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'skill-map-incremental-default-'));
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

function discoveredPlugin(id: string): IDiscoveredPlugin {
  return {
    path: join(projectRoot, '.skill-map', 'plugins', id),
    id,
    status: 'enabled',
    manifest: {
      version: '1.0.0',
      description: 'test plugin',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    },
  };
}

function pluginRuntimeWith(extractors: IExtractor[], discovered: IDiscoveredPlugin[]): IPluginRuntime {
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

function scanOpts(
  runtime: IPluginRuntime,
  mode: {
    changed?: boolean;
    full?: boolean;
    dryRun?: boolean;
    settingsEnv?: Record<string, string>;
    stderr?: NodeJS.WritableStream;
    cwd?: string;
  } = {},
): IScanRunOpts {
  const cwd = mode.cwd ?? projectRoot;
  return {
    roots: [cwd],
    noBuiltIns: false,
    noPlugins: false,
    noTokens: true,
    dryRun: mode.dryRun ?? false,
    changed: mode.changed ?? false,
    ...(mode.full !== undefined ? { full: mode.full } : {}),
    ...(mode.settingsEnv !== undefined ? { settingsEnv: mode.settingsEnv } : {}),
    allowEmpty: true,
    strict: false,
    stderr: mode.stderr ?? silentStderr,
    printer: silentPrinter,
    ctx: { cwd },
    pluginRuntime: runtime,
    yes: true,
    warnOnDrift: false,
  };
}

describe('sm scan incremental-by-default (runner level)', () => {
  it('default reuses cached extractor runs; --full re-extracts; --changed aliases the default', async () => {
    let invocations = 0;
    const probe: IExtractor = {
      kind: 'extractor',
      id: 'count-probe',
      pluginId: 'count-plugin',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      // Declared secret with an env override: the settings RESOLVER
      // (composer-applied, it overwrites any synthetic
      // `resolvedSettings` on the raw extension) picks the env value
      // up, which is how scan 5 below changes the resolved-settings
      // hash through the real channel.
      settings: {
        token: { type: 'secret', label: 'Probe token', envVar: 'COUNT_PROBE_TOKEN' },
      },
      extract: async (): Promise<void> => {
        invocations += 1;
      },
    };
    const runtime = pluginRuntimeWith([probe], [discoveredPlugin('count-plugin')]);

    // Scan 1 (no prior): degrades to full, probe runs on every node.
    const first = await runScanForCommand(scanOpts(runtime));
    strictEqual(first.kind, 'ok');
    const afterFirst = invocations;
    ok(afterFirst > 0, 'probe extractor must run on the first scan');

    // Scan 2 (default, unchanged fixture): incremental default reuses
    // the cached (node, extractor) pairs, so the probe never re-runs.
    const second = await runScanForCommand(scanOpts(runtime));
    strictEqual(second.kind, 'ok');
    strictEqual(
      invocations,
      afterFirst,
      'a default re-scan over an unchanged fixture must reuse cached extractor runs',
    );
    if (second.kind === 'ok') {
      strictEqual(
        second.result.stats.nodesCount,
        first.kind === 'ok' ? first.result.stats.nodesCount : -1,
        'cached reuse must keep the merged graph complete',
      );
    }

    // Scan 3 (--full): cached reuse bypassed, probe runs again.
    const third = await runScanForCommand(scanOpts(runtime, { full: true }));
    strictEqual(third.kind, 'ok');
    ok(
      invocations > afterFirst,
      '--full must re-run extractors even when the prior snapshot matches',
    );

    // Scan 4 (--changed, the explicit alias): cached again, no new runs.
    const afterFull = invocations;
    const fourth = await runScanForCommand(scanOpts(runtime, { changed: true }));
    strictEqual(fourth.kind, 'ok');
    strictEqual(
      invocations,
      afterFull,
      '--changed must behave exactly like the incremental default',
    );

    // Scan 5: same extractor, but the declared secret's envVar now has
    // a value, so the resolver produces a different settings bag. The
    // settings leg of the cache key (settings_hash_at_run) must
    // invalidate the pair so config/env changes take effect without
    // --full.
    const env = { COUNT_PROBE_TOKEN: 'sk-cache-test' };
    const fifth = await runScanForCommand(scanOpts(runtime, { settingsEnv: env }));
    strictEqual(fifth.kind, 'ok');
    ok(
      invocations > afterFull,
      'a resolved-settings change must re-run the extractor on the next incremental scan',
    );

    // Scan 6: same env again, cached again.
    const afterSettings = invocations;
    const sixth = await runScanForCommand(scanOpts(runtime, { settingsEnv: env }));
    strictEqual(sixth.kind, 'ok');
    strictEqual(
      invocations,
      afterSettings,
      'an unchanged settings bag must cache like any other unchanged input',
    );

    // Scan 7 (-n, dry-run): the preview mirrors the live incremental
    // scan, so cached pairs stay cached (DB opened read-side only).
    const beforeDryRun = invocations;
    const seventh = await runScanForCommand(scanOpts(runtime, { dryRun: true, settingsEnv: env }));
    strictEqual(seventh.kind, 'ok');
    strictEqual(
      invocations,
      beforeDryRun,
      'a default dry-run over an unchanged fixture must preview the cached reuse',
    );

    // Scan 8 (-n --full): the preview mirrors the live --full, so the
    // probe re-runs in memory (still no DB write).
    const eighth = await runScanForCommand(
      scanOpts(runtime, { dryRun: true, full: true, settingsEnv: env }),
    );
    strictEqual(eighth.kind, 'ok');
    ok(
      invocations > beforeDryRun,
      'a --full dry-run must preview the complete re-extraction',
    );
  });

  it('the no-prior advisory fires only for the explicit --changed, never for the silent first default scan', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'skill-map-advisory-'));
    try {
      const skill = join(cwd, '.claude', 'skills', 'probe');
      mkdirSync(skill, { recursive: true });
      writeFileSync(
        join(skill, 'SKILL.md'),
        ['---', 'name: probe', 'description: D', '---', 'Body.'].join('\n'),
      );
      const runtime = pluginRuntimeWith([], []);

      const captureStderr = (): { stream: NodeJS.WritableStream; text: () => string } => {
        const chunks: string[] = [];
        return {
          stream: { write: (s: string) => { chunks.push(String(s)); return true; } } as unknown as NodeJS.WritableStream,
          text: () => chunks.join(''),
        };
      };

      // First DEFAULT scan of a fresh scope: degrades to full silently.
      const quiet = captureStderr();
      const first = await runScanForCommand(scanOpts(runtime, { cwd, stderr: quiet.stream }));
      strictEqual(first.kind, 'ok');
      ok(
        !quiet.text().includes('no prior snapshot'),
        'the incremental default must not nag on the first scan of a scope',
      );

      // Explicit --changed against a fresh scope: the documented
      // stderr one-liner fires.
      rmSync(join(cwd, '.skill-map'), { recursive: true, force: true });
      const loud = captureStderr();
      const second = await runScanForCommand(
        scanOpts(runtime, { cwd, changed: true, stderr: loud.stream }),
      );
      strictEqual(second.kind, 'ok');
      ok(
        loud.text().includes('--changed: no prior snapshot found'),
        `explicit --changed with no prior must print the advisory; stderr was: ${loud.text()}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
