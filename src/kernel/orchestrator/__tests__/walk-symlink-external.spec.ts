/**
 * Integration guard for the symlink-containment decision (2026-07-05, see
 * `kernel/scan/walk-content.ts`): the kernel walker refuses a symbolic link
 * whose target escapes the scan roots UNLESS `scan.followExternalSymlinks`
 * is set. `walk-content.spec.ts` pins the walker in isolation; this pins the
 * same behaviour end to end through `walkAndExtract`, and doubles as the
 * propagation guard that the `followExternalSymlinks` option actually
 * threads from the orchestrator options through the Provider walk into the
 * kernel walker (a broken thread fails safe, so only this test would catch
 * an opt-in that silently never takes effect).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkAndExtract } from '../walk.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import { buildProviderFrontmatterValidator } from '../../adapters/schema-validators.js';
import type { IProvider } from '../../extensions/index.js';

let project: string;
let external: string;

const md = (name: string, description: string): string =>
  ['---', `name: ${name}`, `description: ${description}`, '---', 'Body.'].join('\n');

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'skill-map-symlink-project-'));
  external = mkdtempSync(join(tmpdir(), 'skill-map-symlink-external-'));
  // A markdown file that lives OUTSIDE the project root.
  writeFileSync(join(external, 'outside.md'), md('outside', 'lives outside the project'));
  // A baseline file inside the project.
  writeFileSync(join(project, 'inside.md'), md('inside', 'lives in the project'));
  // A symlink inside the project pointing at the external directory.
  symlinkSync(external, join(project, 'linked'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(external, { recursive: true, force: true });
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

async function runWalk(opts?: { followExternalSymlinks?: boolean }) {
  const providers = [makeMarkdownProvider()];
  return walkAndExtract({
    providers,
    extractors: [],
    roots: [project],
    emitter: new InMemoryProgressEmitter(),
    encoder: null,
    strict: false,
    enableCache: false,
    cacheInvalidatedBy: null,
    prior: null,
    priorIndex: {
      priorNodesByPath: new Map(),
      priorLinksByOriginating: new Map(),
      priorFrontmatterIssuesByNode: new Map(),
    },
    priorExtractorRuns: undefined,
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: null,
    scanCeiling: 50000,
    overrideScanCeiling: null,
    maxRenderNodes: 256,
    overrideMaxRenderNodes: null,
    ...(opts?.followExternalSymlinks ? { followExternalSymlinks: true } : {}),
  });
}

describe('walkAndExtract / external symlink', () => {
  it('by default does NOT index a symlinked directory pointing OUTSIDE the scan root', async () => {
    const out = await runWalk();
    const paths = out.nodes.map((n) => n.path).sort();
    ok(paths.includes('inside.md'), `in-project file indexed (got ${JSON.stringify(paths)})`);
    ok(
      !paths.includes('linked/outside.md'),
      `external file behind the escaping symlink is skipped (got ${JSON.stringify(paths)})`,
    );
    strictEqual(out.nodes.length, 1, 'only the in-project file');
  });

  it('indexes the escaping symlink target when followExternalSymlinks propagates through', async () => {
    const out = await runWalk({ followExternalSymlinks: true });
    const paths = out.nodes.map((n) => n.path).sort();
    ok(paths.includes('inside.md'), `in-project file indexed (got ${JSON.stringify(paths)})`);
    ok(
      paths.includes('linked/outside.md'),
      `external file reached through the symlink indexed (got ${JSON.stringify(paths)})`,
    );
    strictEqual(out.nodes.length, 2, 'the in-project file plus the opted-in symlinked external file');
  });
});
