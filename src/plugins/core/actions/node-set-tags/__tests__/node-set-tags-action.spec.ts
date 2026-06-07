/**
 * Built-in `node-set-tags` Action tests.
 *
 * The Action stays pure: `invoke()` is called against synthesised
 * `Node`s. Paths exercised:
 *   - a normal write returns `{ ok: true, tags }` plus a single
 *     `{ kind: 'sidecar', ... }` write whose `changes` carry the
 *     identity hashes, `annotations.tags` (whole-array replace), and the
 *     audit stamp;
 *   - an empty array clears the tags;
 *   - the materialisation half (write -> file) is exercised end-to-end
 *     against `FilesystemSidecarStore`, asserting the previous tags array
 *     is fully replaced (not merged) and a sibling plugin block survives.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  nodeSetTagsAction,
  type INodeSetTagsInput,
  type INodeSetTagsReport,
} from '../index.js';
import {
  FilesystemSidecarStore,
  _resetSidecarStoreValidatorCacheForTests,
} from '../../../../../kernel/sidecar/store.js';
import type { IActionContext, IActionResult } from '../../../../../kernel/extensions/index.js';
import type { Node } from '../../../../../kernel/types.js';
import { ensureSidecarWritesAllowed } from '../../../../../core/config/sidecar-consent.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let tmpRoot: string;
let consentRoot: string;

function consentBag(): { confirm: boolean; cwd: string } {
  return { confirm: false, cwd: consentRoot };
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-set-tags-action-'));
  consentRoot = mkdtempSync(join(tmpdir(), 'sm-set-tags-action-consent-'));
  mkdirSync(join(consentRoot, '.skill-map'), { recursive: true });
  writeFileSync(
    join(consentRoot, '.skill-map', 'settings.local.json'),
    JSON.stringify({ allowEditSmFiles: true }),
    'utf8',
  );
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(consentRoot, { recursive: true, force: true });
});

beforeEach(() => {
  _resetSidecarStoreValidatorCacheForTests();
});

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    path: 'docs/x.md',
    kind: 'agent',
    provider: 'claude',
    bodyHash: HASH_A,
    frontmatterHash: HASH_B,
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...overrides,
  };
}

function makeCtx(node: Node, mdAbsPath: string, invoker = 'cli'): IActionContext {
  return {
    node,
    nodeAbsolutePath: mdAbsPath,
    invoker,
    now: () => new Date('2026-05-05T12:00:00.000Z'),
    settings: {},
  };
}

function callSetTags(
  input: INodeSetTagsInput,
  ctx: IActionContext,
): IActionResult<INodeSetTagsReport> {
  if (!nodeSetTagsAction.invoke) throw new Error('nodeSetTagsAction.invoke missing');
  return nodeSetTagsAction.invoke<INodeSetTagsInput, INodeSetTagsReport>(input, ctx);
}

describe('built-in node-set-tags action, normal write produces a patch', () => {
  it('writes annotations.tags, refreshes identity, stamps audit', () => {
    const node = makeNode({ path: 'docs/x.md', bodyHash: HASH_A, frontmatterHash: HASH_B });
    const result = callSetTags({ tags: ['core', 'wip'] }, makeCtx(node, '/repo/docs/x.md', 'cli'));

    strictEqual(result.report.ok, true);
    deepStrictEqual(result.report.tags, ['core', 'wip']);

    ok(result.writes && result.writes.length === 1);
    const w = result.writes[0]!;
    strictEqual(w.kind, 'sidecar');
    strictEqual(w.path, '/repo/docs/x.sm');
    deepStrictEqual(w.changes['identity'], {
      path: 'docs/x.md',
      bodyHash: HASH_A,
      frontmatterHash: HASH_B,
    });
    deepStrictEqual(w.changes['annotations'], { tags: ['core', 'wip'] });
    deepStrictEqual(w.changes['audit'], {
      lastBumpedAt: '2026-05-05T12:00:00.000Z',
      lastBumpedBy: 'cli',
    });
  });

  it('writes an empty array to clear tags', () => {
    const node = makeNode();
    const result = callSetTags({ tags: [] }, makeCtx(node, '/repo/docs/x.md', 'cli'));
    strictEqual(result.report.ok, true);
    deepStrictEqual(result.report.tags, []);
    ok(result.writes && result.writes.length === 1);
    deepStrictEqual(result.writes[0]!.changes['annotations'], { tags: [] });
  });

  it('coerces a missing tags input to an empty array', () => {
    const node = makeNode();
    const result = callSetTags(
      {} as unknown as INodeSetTagsInput,
      makeCtx(node, '/repo/docs/x.md', 'cli'),
    );
    strictEqual(result.report.ok, true);
    deepStrictEqual(result.report.tags, []);
  });
});

describe('built-in node-set-tags action, round-trip through FilesystemSidecarStore', () => {
  it('replaces the prior tags array wholesale and preserves a sibling plugin block', async () => {
    const target = join(tmpRoot, 'plugin-merge.sm');
    const seed = {
      identity: { path: 'docs/x.md', bodyHash: HASH_A, frontmatterHash: HASH_B },
      annotations: { version: 4, tags: ['old-a', 'old-b'] },
      'example-plugin': { reviewedBy: 'agent-x', notes: ['ok'] },
    };
    writeFileSync(target, yaml.dump(seed));

    const node = makeNode({ path: 'docs/x.md' });
    const result = callSetTags(
      { tags: ['new-only'] },
      makeCtx(node, target.replace(/\.sm$/, '.md'), 'cli'),
    );
    ok(result.writes);

    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    for (const w of result.writes!) {
      if (w.kind === 'sidecar') await store.applyPatch(w.path, w.changes, consentBag());
    }

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const ann = parsed['annotations'] as Record<string, unknown>;
    // Whole-array replace: the old tags are gone, not merged.
    deepStrictEqual(ann['tags'], ['new-only']);
    // pre-existing version preserved.
    strictEqual(ann['version'], 4);
    // Plugin namespace fully preserved.
    deepStrictEqual(parsed['example-plugin'], { reviewedBy: 'agent-x', notes: ['ok'] });
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
    strictEqual(audit['lastBumpedAt'], '2026-05-05T12:00:00.000Z');
  });
});
