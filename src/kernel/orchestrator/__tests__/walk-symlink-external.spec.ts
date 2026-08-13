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
import { indexPriorSnapshot } from '../cache.js';
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

async function runWalk(opts?: {
  followExternalSymlinks?: boolean;
  prior?: import('../../types.js').ScanResult;
  changed?: readonly string[];
  extractors?: import('../../extensions/index.js').IExtractor[];
}) {
  const providers = [makeMarkdownProvider()];
  const prior = opts?.prior ?? null;
  return walkAndExtract({
    providers,
    extractors: opts?.extractors ?? [],
    roots: [project],
    emitter: new InMemoryProgressEmitter(),
    encoder: null,
    strict: false,
    enableCache: prior !== null,
    cacheInvalidatedBy: null,
    prior,
    priorIndex: indexPriorSnapshot(prior),
    // Empty (not undefined) when a prior exists: the fine-grained path
    // runs with NO cached extractor run, so every unchanged node
    // re-extracts and `ensureBody` fires the reread this spec guards.
    priorExtractorRuns: prior === null ? undefined : new Map(),
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: null,
    scanCeiling: 50000,
    overrideScanCeiling: null,
    maxRenderNodes: 256,
    overrideMaxRenderNodes: null,
    ...(opts?.followExternalSymlinks ? { followExternalSymlinks: true } : {}),
    ...(opts?.changed
      ? {
          incrementalChangedPaths: {
            changed: new Set(opts.changed),
            removed: new Set<string>(),
          },
        }
      : {}),
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

  it('keeps the symlinked node CONTENT on an incremental reread of unchanged nodes', async () => {
    // The other half of the propagation guard. The incremental
    // (changed-files) pass injects every unchanged prior node with a lazy
    // `reread` (`buildUnchangedRawNode`); that reread used to run the
    // scoped provider walk on the gate's DEFAULT instead of the scan's
    // own config, so it yielded nothing for a node behind an authorised
    // external symlink and degraded to EMPTY content: extractors re-ran
    // over a blank body and the node's derived data silently vanished.
    const cold = await runWalk({ followExternalSymlinks: true });
    strictEqual(cold.nodes.length, 2);
    const prior = {
      nodes: cold.nodes,
      links: cold.internalLinks,
      issues: [],
    } as unknown as import('../../types.js').ScanResult;

    // What each extractor pass actually SAW for the symlinked node.
    const seenBodies: string[] = [];
    const probeExtractor = {
      id: 'probe',
      pluginId: 'test',
      kind: 'extractor',
      version: '1.0.0',
      description: 'records the body the re-extraction reads',
      extract: (ctx: { node: { path: string }; body: string }) => {
        if (ctx.node.path === 'linked/outside.md') seenBodies.push(ctx.body);
        return [];
      },
    } as unknown as import('../../extensions/index.js').IExtractor;

    // Someone edits the IN-PROJECT file; the symlinked node is unchanged.
    const incremental = await runWalk({
      followExternalSymlinks: true,
      prior,
      changed: ['inside.md'],
      extractors: [probeExtractor],
    });

    strictEqual(
      incremental.nodes.find((n) => n.path === 'linked/outside.md') !== undefined,
      true,
      'the unchanged symlinked node survives the incremental pass',
    );
    strictEqual(seenBodies.length > 0, true, 'the re-extraction actually ran for it');
    ok(
      seenBodies.every((body) => body.includes('Body.')),
      `the reread must surface the REAL body, not blank it (saw ${JSON.stringify(seenBodies)})`,
    );
  });
});
