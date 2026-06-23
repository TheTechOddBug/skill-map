/**
 * Unit tests for the walk-intake ceiling in `walkAndExtract` (kernel,
 * `src/kernel/orchestrator/walk.ts`). The ceiling is driven by
 * `scanCeiling` plus the optional `overrideScanCeiling` (mirror of
 * `scan.maxScan` and `--max-scan <N>`). The render cap (`maxRenderNodes`
 * / `overrideMaxRenderNodes`, mirror of `scan.maxNodes` / `--max-nodes`)
 * is carried through as pure metadata and MUST NOT bound the walk.
 *
 * Behaviour pinned here:
 *
 *   - When the walker hits the effective ceiling, it stops accepting
 *     more files. `accum.nodes.length === effectiveCeiling`;
 *     `scanTruncated: true`.
 *   - `filesWalked` increments before the ceiling check, so a real
 *     truncation leaves `filesWalked === effectiveCeiling + 1` (one
 *     extra iteration before the inner `break`).
 *   - `overrideScanCeiling` is bidirectional: raising it past the
 *     setting relaxes the ceiling; lowering it past the setting cuts
 *     deeper.
 *   - When the project has fewer files than the ceiling, the loop ends
 *     naturally with `scanTruncated: false`.
 *   - The render cap (`maxRenderNodes`) never bounds the walk: a tiny
 *     render cap with a high ceiling still scans every file.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkAndExtract } from '../walk.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import { buildProviderFrontmatterValidator } from '../../adapters/schema-validators.js';
import type { IProvider } from '../../extensions/index.js';

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-walk-node-cap-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  for (let i = 0; i < 5; i++) {
    write(`docs/file-${i}.md`, ['---', `name: f${i}`, `description: d${i}`, '---', `Body ${i}.`].join('\n'));
  }
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Single universal Provider that classifies every `.md` as `note`. Keeps
 * the fixture closed to one stable provider so `filesWalked` lines up
 * 1:1 with the number of files emitted by the walker.
 */
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

interface ICapRunArgs {
  scanCeiling: number;
  overrideScanCeiling: number | null;
  maxRenderNodes?: number;
  overrideMaxRenderNodes?: number | null;
}

async function runCapWalk(args: ICapRunArgs) {
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
      priorLinksByOriginating: new Map(),
      priorFrontmatterIssuesByNode: new Map(),
    },
    priorExtractorRuns: undefined,
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: null,
    scanCeiling: args.scanCeiling,
    overrideScanCeiling: args.overrideScanCeiling,
    maxRenderNodes: args.maxRenderNodes ?? 256,
    overrideMaxRenderNodes: args.overrideMaxRenderNodes ?? null,
  });
}

describe('walkAndExtract / walk-intake ceiling', () => {
  it('default ceiling: truncation fires when project exceeds the ceiling', async () => {
    const out = await runCapWalk({ scanCeiling: 3, overrideScanCeiling: null });

    strictEqual(out.nodes.length, 3, 'walker should stop at the configured ceiling');
    strictEqual(out.scanTruncated, true, 'scanTruncated must be true when files were dropped');
    strictEqual(
      out.filesWalked > 3,
      true,
      `filesWalked must be strictly greater than the ceiling when it fires (got ${out.filesWalked})`,
    );
    strictEqual(out.scanCeiling, 3, 'effective ceiling is reported back');
  });

  it('override above the setting relaxes the ceiling', async () => {
    const out = await runCapWalk({ scanCeiling: 3, overrideScanCeiling: 10 });

    strictEqual(out.nodes.length, 5, 'override 10 admits every fixture file');
    strictEqual(out.scanTruncated, false, 'override 10 exceeds the file count; ceiling must not fire');
    strictEqual(out.scanCeiling, 10, 'effective ceiling is the override');
  });

  it('override below the setting cuts deeper (bidirectional)', async () => {
    const out = await runCapWalk({ scanCeiling: 3, overrideScanCeiling: 1 });

    strictEqual(out.nodes.length, 1, 'override 1 cuts past the setting');
    strictEqual(out.scanTruncated, true);
    strictEqual(out.scanCeiling, 1);
  });

  it('project below the ceiling: truncation never fires', async () => {
    const out = await runCapWalk({ scanCeiling: 100, overrideScanCeiling: null });

    strictEqual(out.nodes.length, 5, 'every fixture file should land in nodes');
    strictEqual(out.scanTruncated, false);
    strictEqual(out.filesWalked, 5, 'filesWalked must equal the file count when the ceiling never fires');
  });

  it('render cap does NOT bound the walk: low maxNodes, high maxScan scans everything', async () => {
    const out = await runCapWalk({
      scanCeiling: 100,
      overrideScanCeiling: null,
      maxRenderNodes: 2,
      overrideMaxRenderNodes: 1,
    });

    strictEqual(out.nodes.length, 5, 'a tiny render cap must not drop any walked file');
    strictEqual(out.scanTruncated, false, 'render cap can never truncate the walk');
    strictEqual(out.maxRenderNodes, 1, 'effective render cap (override) is reported back unchanged');
    strictEqual(out.scanCeiling, 100, 'walk ceiling is untouched by the render cap');
  });
});
