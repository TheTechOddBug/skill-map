/**
 * Step 9.6.6, plugin annotation-contribution loader + cross-plugin
 * conflict-detection tests.
 *
 * Two surfaces:
 *
 *   - Per-extension validation in `kernel/adapters/plugin-loader.ts`
 *     (`validateAnnotationContributions`): a contribution with
 *     `location: 'root'` MUST also declare `ownership: 'exclusive'`,
 *     and the inline `schema` MUST AJV-compile cleanly. Either failure
 *     marks the plugin as `invalid-manifest`.
 *
 *   - Cross-plugin collision detection in
 *     `core/runtime/plugin-runtime.ts:loadPluginRuntime`: two plugins
 *     claiming the same `(key, location: 'root', ownership: 'exclusive')`
 *     tuple is FATAL, `loadPluginRuntime` throws an
 *     `AnnotationContributionConflictError` and the kernel does not boot.
 */

import { after, before, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AnnotationContributionConflictError,
  loadPluginRuntime,
} from '../../core/runtime/plugin-runtime.js';

let root: string;
let counter = 0;

function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface IContributionShape {
  schema: Record<string, unknown>;
  ownership?: 'exclusive' | 'shared';
  location?: 'namespaced' | 'root';
}

/**
 * Plant a plugin whose extension contributes a single annotation key.
 * Structure-as-truth: the annotation key equals the extension's folder
 * name (`<extensionId>`), and the manifest declares one `annotation`
 * object (no map). Tests that previously emulated multiple keys with a
 * map now plant the extension under the desired key name; the extension
 * id IS the key.
 */
function plantPluginWithContribution(
  pluginsDir: string,
  id: string,
  extensionId: string,
  annotation: IContributionShape,
): void {
  const dir = join(pluginsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      version: '1.0.0',
      description: 'test',
      specCompat: '>=0.0.0',
      catalogCompat: '*',
    }),
  );
  const extDir = join(dir, 'extractors', extensionId);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, 'index.mjs'),
    `export default {
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      annotation: ${JSON.stringify(annotation)},
      extract() {},
    };`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-annot-contrib-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('plugin annotation contributions, per-extension validation', () => {
  it('accepts a well-formed namespaced contribution', async () => {
    const dir = freshDir('ok-namespaced');
    plantPluginWithContribution(dir, 'reviewer', 'lastReviewedAt', {
      schema: { type: 'string' },
    });

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.discovered[0]!.status, 'enabled');
    assert.equal(runtime.annotationContributions.length, 1);
    const entry = runtime.annotationContributions[0]!;
    assert.equal(entry.pluginId, 'reviewer');
    assert.equal(entry.key, 'lastReviewedAt');
    assert.equal(entry.location, 'namespaced'); // default
    assert.equal(entry.ownership, 'shared'); // default
  });

  it('accepts a well-formed root-exclusive contribution', async () => {
    const dir = freshDir('ok-root-excl');
    plantPluginWithContribution(dir, 'compliance', 'compliance', {
      schema: { type: 'object' },
      location: 'root',
      ownership: 'exclusive',
    });

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.discovered[0]!.status, 'enabled');
    assert.equal(runtime.annotationContributions.length, 1);
    assert.equal(runtime.annotationContributions[0]!.location, 'root');
    assert.equal(runtime.annotationContributions[0]!.ownership, 'exclusive');
  });

  it('rejects location:root with shared ownership as invalid-manifest', async () => {
    const dir = freshDir('bad-root-shared');
    plantPluginWithContribution(dir, 'sneaky', 'compliance', {
      schema: { type: 'object' },
      location: 'root',
      // ownership omitted, defaults to 'shared'
    });

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.discovered[0]!.status, 'invalid-manifest');
    assert.match(runtime.discovered[0]!.reason ?? '', /location: 'root'/);
    assert.equal(runtime.annotationContributions.length, 0);
  });

  it("rejects an invalid inline JSON Schema as invalid-manifest", async () => {
    const dir = freshDir('bad-schema');
    plantPluginWithContribution(dir, 'broken', 'typo', {
      schema: { type: 'not-a-real-type' },
    });

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.discovered[0]!.status, 'invalid-manifest');
    assert.match(runtime.discovered[0]!.reason ?? '', /annotation/);
  });
});

describe('plugin annotation contributions, cross-plugin conflict', () => {
  it('two plugins claiming the same root-exclusive key is fatal', async () => {
    const dir = freshDir('conflict');
    plantPluginWithContribution(dir, 'plugin-a', 'compliance', {
      schema: { type: 'object' },
      location: 'root',
      ownership: 'exclusive',
    });
    plantPluginWithContribution(dir, 'plugin-b', 'compliance', {
      schema: { type: 'object' },
      location: 'root',
      ownership: 'exclusive',
    });

    await assert.rejects(
      () => loadPluginRuntime({ pluginDir: dir }),
      (err: unknown) => {
        assert.ok(err instanceof AnnotationContributionConflictError, 'right error class');
        const e = err as AnnotationContributionConflictError;
        assert.equal(e.key, 'compliance');
        assert.deepEqual([...e.plugins].sort(), ['plugin-a', 'plugin-b']);
        return true;
      },
    );
  });

  it('two plugins on the same NAMESPACED key are NOT a conflict (last-write-wins)', async () => {
    const dir = freshDir('shared-namespaced');
    plantPluginWithContribution(dir, 'plugin-a', 'tag', {
      schema: { type: 'string' },
    });
    plantPluginWithContribution(dir, 'plugin-b', 'tag', {
      schema: { type: 'string' },
    });

    const runtime = await loadPluginRuntime({ pluginDir: dir });
    assert.equal(runtime.annotationContributions.length, 2);
    // Both plugins surfaced; namespaced contributions live under their
    // own `<plugin-id>:` block at runtime, so the same key under two
    // different namespaces never collides.
    const pluginIds = runtime.annotationContributions.map((c) => c.pluginId).sort();
    assert.deepEqual(pluginIds, ['plugin-a', 'plugin-b']);
  });
});
