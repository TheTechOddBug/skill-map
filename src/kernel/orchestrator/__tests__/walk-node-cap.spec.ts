/**
 * Unit tests for the node cap in `walkAndExtract` (kernel,
 * `src/kernel/orchestrator/walk.ts`). The cap is driven by
 * `recommendedNodeLimit` plus the optional `overrideMaxNodes` (mirror
 * of `scan.maxNodes` and `--max-nodes <N>`).
 *
 * Behaviour pinned here:
 *
 *   - When the walker hits the effective cap, it stops accepting more
 *     files. `accum.nodes.length === effectiveLimit`; `capReached: true`.
 *   - `filesWalked` increments before the cap check, so a real cap-hit
 *     leaves `filesWalked === effectiveLimit + 1` (one extra iteration
 *     before the inner `break`).
 *   - `overrideMaxNodes` is bidirectional: raising it past the
 *     recommendation relaxes the cap; lowering it past the
 *     recommendation cuts deeper.
 *   - When the project has fewer files than the cap, the loop ends
 *     naturally with `capReached: false`.
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
  recommendedNodeLimit: number;
  overrideMaxNodes: number | null;
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
      priorNodePaths: new Set(),
      priorLinksByOriginating: new Map(),
      priorFrontmatterIssuesByNode: new Map(),
    },
    priorExtractorRuns: undefined,
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: null,
    recommendedNodeLimit: args.recommendedNodeLimit,
    overrideMaxNodes: args.overrideMaxNodes,
  });
}

describe('walkAndExtract / node cap', () => {
  it('default recommendation: cap fires when project exceeds the limit', async () => {
    const out = await runCapWalk({ recommendedNodeLimit: 3, overrideMaxNodes: null });

    strictEqual(out.nodes.length, 3, 'walker should stop at the recommended limit');
    strictEqual(out.capReached, true, 'capReached must be true when files were dropped');
    strictEqual(
      out.filesWalked > 3,
      true,
      `filesWalked must be strictly greater than the cap when it fires (got ${out.filesWalked})`,
    );
    strictEqual(out.recommendedNodeLimit, 3);
    strictEqual(out.overrideMaxNodes, null);
  });

  it('override above the recommendation relaxes the cap', async () => {
    const out = await runCapWalk({ recommendedNodeLimit: 3, overrideMaxNodes: 10 });

    strictEqual(out.nodes.length, 5, 'override 10 admits every fixture file');
    strictEqual(out.capReached, false, 'override 10 exceeds the file count; cap must not fire');
    strictEqual(out.overrideMaxNodes, 10);
  });

  it('override below the recommendation cuts deeper (bidirectional)', async () => {
    const out = await runCapWalk({ recommendedNodeLimit: 3, overrideMaxNodes: 1 });

    strictEqual(out.nodes.length, 1, 'override 1 cuts past the recommendation');
    strictEqual(out.capReached, true);
    strictEqual(out.overrideMaxNodes, 1);
  });

  it('project below the limit: cap never fires', async () => {
    const out = await runCapWalk({ recommendedNodeLimit: 100, overrideMaxNodes: null });

    strictEqual(out.nodes.length, 5, 'every fixture file should land in nodes');
    strictEqual(out.capReached, false);
    strictEqual(out.filesWalked, 5, 'filesWalked must equal the file count when the cap never fires');
  });
});
