/**
 * Built-in `node-set-stability` Action tests.
 *
 * The Action stays pure: `invoke()` is called against synthesised
 * `Node`s. Three paths are exercised:
 *   - out-of-enum value refuses with `{ ok: false, reason: 'invalid' }`
 *     and emits no writes;
 *   - a normal write returns `{ ok: true, stability }` plus a single
 *     `{ kind: 'sidecar', ... }` write whose `changes` carry the
 *     identity hashes, `annotations.stability`, and the audit stamp;
 *   - the materialisation half (write -> file) is exercised end-to-end
 *     against `FilesystemSidecarStore` so the round-trip holds.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  nodeSetStabilityAction,
  type INodeSetStabilityInput,
  type INodeSetStabilityReport,
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
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-set-stability-action-'));
  consentRoot = mkdtempSync(join(tmpdir(), 'sm-set-stability-action-consent-'));
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

function callSetStability(
  input: INodeSetStabilityInput,
  ctx: IActionContext,
): IActionResult<INodeSetStabilityReport> {
  if (!nodeSetStabilityAction.invoke) throw new Error('nodeSetStabilityAction.invoke missing');
  return nodeSetStabilityAction.invoke<INodeSetStabilityInput, INodeSetStabilityReport>(input, ctx);
}

describe('built-in node-set-stability action, out-of-enum refusal', () => {
  it('refuses an out-of-enum value (no writes)', () => {
    const node = makeNode();
    const result = callSetStability(
      { stability: 'beta' as unknown as INodeSetStabilityInput['stability'] },
      makeCtx(node, '/repo/docs/x.md'),
    );

    strictEqual(result.report.ok, false);
    strictEqual(result.report.reason, 'invalid');
    strictEqual(result.report.stability, undefined);
    strictEqual(result.writes, undefined);
  });

  it('refuses a missing value (no writes)', () => {
    const node = makeNode();
    const result = callSetStability(
      {} as unknown as INodeSetStabilityInput,
      makeCtx(node, '/repo/docs/x.md'),
    );
    strictEqual(result.report.ok, false);
    strictEqual(result.report.reason, 'invalid');
    strictEqual(result.writes, undefined);
  });
});

describe('built-in node-set-stability action, normal write produces a patch', () => {
  for (const stability of ['experimental', 'stable', 'deprecated'] as const) {
    it(`writes annotations.stability = ${stability}, refreshes identity, stamps audit`, () => {
      const node = makeNode({ path: 'docs/x.md', bodyHash: HASH_A, frontmatterHash: HASH_B });
      const result = callSetStability({ stability }, makeCtx(node, '/repo/docs/x.md', 'cli'));

      strictEqual(result.report.ok, true);
      strictEqual(result.report.stability, stability);
      strictEqual(result.report.reason, undefined);

      ok(result.writes && result.writes.length === 1);
      const w = result.writes[0]!;
      strictEqual(w.kind, 'sidecar');
      strictEqual(w.path, '/repo/docs/x.sm');
      deepStrictEqual(w.changes['identity'], {
        path: 'docs/x.md',
        bodyHash: HASH_A,
        frontmatterHash: HASH_B,
      });
      deepStrictEqual(w.changes['annotations'], { stability });
      deepStrictEqual(w.changes['audit'], {
        lastBumpedAt: '2026-05-05T12:00:00.000Z',
        lastBumpedBy: 'cli',
      });
    });
  }
});

describe('built-in node-set-stability action, round-trip through FilesystemSidecarStore', () => {
  it('preserves a <plugin-id>: namespaced block when the kernel materialises the patch', async () => {
    const target = join(tmpRoot, 'plugin-merge.sm');
    const seed = {
      identity: { path: 'docs/x.md', bodyHash: HASH_A, frontmatterHash: HASH_B },
      annotations: { version: 4 },
      'example-plugin': { reviewedBy: 'agent-x', notes: ['ok'] },
    };
    writeFileSync(target, yaml.dump(seed));

    const node = makeNode({ path: 'docs/x.md' });
    const result = callSetStability(
      { stability: 'deprecated' },
      makeCtx(node, target.replace(/\.sm$/, '.md'), 'cli'),
    );
    ok(result.writes);

    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    for (const w of result.writes!) {
      if (w.kind === 'sidecar') await store.applyPatch(w.path, w.changes, consentBag());
    }

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const ann = parsed['annotations'] as Record<string, unknown>;
    strictEqual(ann['stability'], 'deprecated');
    // pre-existing version preserved.
    strictEqual(ann['version'], 4);
    // Plugin namespace fully preserved.
    deepStrictEqual(parsed['example-plugin'], { reviewedBy: 'agent-x', notes: ['ok'] });
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
    strictEqual(audit['lastBumpedAt'], '2026-05-05T12:00:00.000Z');
  });
});
