/**
 * Built-in `node-supersede` Action tests.
 *
 * The Action stays pure: `invoke()` is called against synthesised
 * `Node`s. Two paths are exercised:
 *   - self-supersede (`supersededBy === ctx.node.path`) refuses with
 *     `{ ok: false, reason: 'self' }` and emits no writes;
 *   - a normal declaration returns `{ ok: true, supersededBy }` plus a
 *     single `{ kind: 'sidecar', ... }` write whose `changes` carry the
 *     identity hashes, `annotations.supersededBy`, and the audit stamp.
 * The materialisation half (write -> file) is exercised end-to-end
 * against `FilesystemSidecarStore` so the round-trip holds.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  nodeSupersedeAction,
  type INodeSupersedeInput,
  type INodeSupersedeReport,
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

/**
 * Consent bag for tests where the gate is not the subject, points at a
 * fixture root with `allowEditSmFiles: true` pre-granted so the `.sm`
 * write proceeds silently.
 */
function consentBag(): { confirm: boolean; cwd: string } {
  return { confirm: false, cwd: consentRoot };
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-supersede-action-'));
  consentRoot = mkdtempSync(join(tmpdir(), 'sm-supersede-action-consent-'));
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
    path: 'docs/old.md',
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

function callSupersede(
  input: INodeSupersedeInput,
  ctx: IActionContext,
): IActionResult<INodeSupersedeReport> {
  if (!nodeSupersedeAction.invoke) throw new Error('nodeSupersedeAction.invoke missing');
  return nodeSupersedeAction.invoke<INodeSupersedeInput, INodeSupersedeReport>(input, ctx);
}

describe('built-in supersede action, self-supersede refusal', () => {
  it('refuses when supersededBy equals the node path (no writes)', () => {
    const node = makeNode({ path: 'docs/old.md' });
    const result = callSupersede(
      { supersededBy: 'docs/old.md' },
      makeCtx(node, '/repo/docs/old.md'),
    );

    strictEqual(result.report.ok, false);
    strictEqual(result.report.reason, 'self');
    strictEqual(result.report.supersededBy, undefined);
    strictEqual(result.writes, undefined);
  });
});

describe('built-in supersede action, normal declaration produces a patch', () => {
  it('writes annotations.supersededBy, refreshes identity, stamps audit', () => {
    const node = makeNode({ path: 'docs/old.md', bodyHash: HASH_A, frontmatterHash: HASH_B });
    const result = callSupersede(
      { supersededBy: 'docs/new.md' },
      makeCtx(node, '/repo/docs/old.md', 'cli'),
    );

    strictEqual(result.report.ok, true);
    strictEqual(result.report.supersededBy, 'docs/new.md');
    strictEqual(result.report.reason, undefined);

    ok(result.writes && result.writes.length === 1);
    const w = result.writes[0]!;
    strictEqual(w.kind, 'sidecar');
    strictEqual(w.path, '/repo/docs/old.sm');
    deepStrictEqual(w.changes['identity'], {
      path: 'docs/old.md',
      bodyHash: HASH_A,
      frontmatterHash: HASH_B,
    });
    deepStrictEqual(w.changes['annotations'], { supersededBy: 'docs/new.md' });
    deepStrictEqual(w.changes['audit'], {
      lastBumpedAt: '2026-05-05T12:00:00.000Z',
      lastBumpedBy: 'cli',
    });
  });
});

describe('built-in supersede action, round-trip through FilesystemSidecarStore', () => {
  it('preserves a <plugin-id>: namespaced block when the kernel materialises the patch', async () => {
    const target = join(tmpRoot, 'plugin-merge.sm');
    const seed = {
      identity: { path: 'docs/old.md', bodyHash: HASH_A, frontmatterHash: HASH_B },
      annotations: { version: 4 },
      'example-plugin': { reviewedBy: 'agent-x', notes: ['ok'] },
    };
    writeFileSync(target, yaml.dump(seed));

    const node = makeNode({ path: 'docs/old.md' });
    const result = callSupersede(
      { supersededBy: 'docs/new.md' },
      makeCtx(node, target.replace(/\.sm$/, '.md'), 'cli'),
    );
    ok(result.writes);

    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    for (const w of result.writes!) {
      if (w.kind === 'sidecar') await store.applyPatch(w.path, w.changes, consentBag());
    }

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const ann = parsed['annotations'] as Record<string, unknown>;
    // supersededBy merged.
    strictEqual(ann['supersededBy'], 'docs/new.md');
    // pre-existing version preserved.
    strictEqual(ann['version'], 4);
    // Plugin namespace fully preserved.
    deepStrictEqual(parsed['example-plugin'], { reviewedBy: 'agent-x', notes: ['ok'] });
    // audit populated.
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
    strictEqual(audit['lastBumpedAt'], '2026-05-05T12:00:00.000Z');
  });
});
