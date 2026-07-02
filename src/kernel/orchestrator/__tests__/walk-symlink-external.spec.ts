/**
 * Integration guard for the 2026-07-02 symlink decision (see
 * `kernel/scan/walk-content.ts`): the kernel walker ALWAYS follows symbolic
 * links, including a link whose target resolves OUTSIDE the scan roots (the
 * realpath-containment gate was removed; only cycle detection remains).
 *
 * `walk-content.spec.ts` pins the walker in isolation; this pins the same
 * behaviour end to end through `walkAndExtract`, so a symlinked directory
 * pointing outside the project turns into real scan nodes (the exact case a
 * user hit: `fixtures/ignore/skills -> ../../../skills`).
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

async function runWalk() {
  const providers = [makeMarkdownProvider()];
  return walkAndExtract({
    providers,
    extractors: [],
    roots: [project],
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
    scanCeiling: 50000,
    overrideScanCeiling: null,
    maxRenderNodes: 256,
    overrideMaxRenderNodes: null,
  });
}

describe('walkAndExtract / external symlink', () => {
  it('follows a symlinked directory pointing OUTSIDE the scan root and indexes its files', async () => {
    const out = await runWalk();
    const paths = out.nodes.map((n) => n.path).sort();
    ok(paths.includes('inside.md'), `in-project file indexed (got ${JSON.stringify(paths)})`);
    ok(
      paths.includes('linked/outside.md'),
      `external file reached through the symlink indexed (got ${JSON.stringify(paths)})`,
    );
    strictEqual(out.nodes.length, 2, 'exactly the in-project file plus the symlinked external file');
  });
});
