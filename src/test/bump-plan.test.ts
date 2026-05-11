/**
 * Unit tests for `cli/commands/bump-plan.ts:computeBumpPlan`.
 *
 * The plan is the pure half of the architect-audit refactor: the verb
 * is split into `computeBumpPlan` (side-effect free — wraps the
 * Action, runs the path-guard, returns a typed plan) and the writer
 * loop in `BumpCommand` (impure — applies writes through
 * `FilesystemSidecarStore`, runs `git add`). These tests cover the
 * pure half exhaustively so the verb-level integration tests in
 * `bump-cli.test.ts` can focus on the impure half (consent gate,
 * `--staged` git wiring, render).
 *
 * Fixtures: synthesised `Node`s with the sidecar overlay set the way
 * the kernel's 9.6.2 reader would set it. No disk writes — the
 * Action is pure, the path-guard is pure, and `resolve()` is a
 * string op.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { computeBumpPlan } from '../cli/commands/bump-plan.js';
import type { Node } from '../kernel/types.js';

const CWD = '/tmp/sm-bump-plan-fixture';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    path: 'docs/example.md',
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

describe('computeBumpPlan() — empty input', () => {
  it('returns a plan with an empty items array', () => {
    const plan = computeBumpPlan([], { cwd: CWD, force: false });
    assert.deepEqual(plan.items, []);
  });
});

describe('computeBumpPlan() — path guard', () => {
  it('emits a status:"error" item when `node.path` is absolute (tampered DB shape)', () => {
    const node = makeNode({ path: '/etc/passwd' });
    const plan = computeBumpPlan([node], { cwd: CWD, force: false });
    assert.equal(plan.items.length, 1);
    const item = plan.items[0]!;
    assert.equal(item.status, 'error');
    assert.equal(item.nodePath, '/etc/passwd');
    if (item.status === 'error') {
      assert.match(item.message, /absolute|refusing/i);
    }
  });

  it('emits a status:"error" item when `node.path` escapes the cwd via `..`', () => {
    const node = makeNode({ path: '../../../etc/passwd' });
    const plan = computeBumpPlan([node], { cwd: CWD, force: false });
    const item = plan.items[0]!;
    assert.equal(item.status, 'error');
    if (item.status === 'error') {
      assert.match(item.message, /escapes/i);
    }
  });
});

describe('computeBumpPlan() — Action outcomes', () => {
  it('emits status:"refused" for a fresh node when force is false', () => {
    const node = makeNode({
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 3 },
      },
    });
    const plan = computeBumpPlan([node], { cwd: CWD, force: false });
    const item = plan.items[0]!;
    assert.equal(item.status, 'refused');
    assert.equal(item.nodePath, 'docs/example.md');
    if (item.status === 'refused') {
      assert.ok(item.absPath.endsWith('docs/example.md'));
    }
  });

  it('emits status:"skipped" (reason: noop) for a fresh node when force is true', () => {
    const node = makeNode({
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 3 },
      },
    });
    const plan = computeBumpPlan([node], { cwd: CWD, force: true });
    const item = plan.items[0]!;
    assert.equal(item.status, 'skipped');
    if (item.status === 'skipped') {
      assert.equal(item.reason, 'noop');
    }
  });

  it('emits status:"bumped" with writes for a stale node', () => {
    const node = makeNode({
      sidecar: {
        present: true,
        status: 'stale-body',
        annotations: { version: 5 },
      },
    });
    const plan = computeBumpPlan([node], { cwd: CWD, force: false });
    const item = plan.items[0]!;
    assert.equal(item.status, 'bumped');
    if (item.status === 'bumped') {
      assert.equal(item.report.ok, true);
      assert.equal(item.report.version, 6);
      assert.equal(item.writes.length, 1);
      assert.equal(item.writes[0]!.kind, 'sidecar');
    }
  });

  it('emits status:"bumped" with createdSidecar:true for a node without a sidecar overlay', () => {
    const node = makeNode();
    const plan = computeBumpPlan([node], { cwd: CWD, force: false });
    const item = plan.items[0]!;
    assert.equal(item.status, 'bumped');
    if (item.status === 'bumped') {
      assert.equal(item.report.createdSidecar, true);
      assert.equal(item.report.version, 1);
    }
  });
});

describe('computeBumpPlan() — batch behaviour', () => {
  it('preserves input order (no sort, the caller pre-sorts)', () => {
    const a = makeNode({ path: 'docs/aaa.md' });
    const b = makeNode({ path: 'docs/bbb.md' });
    const c = makeNode({ path: 'docs/ccc.md' });
    const plan = computeBumpPlan([c, a, b], { cwd: CWD, force: false });
    assert.deepEqual(
      plan.items.map((i) => i.nodePath),
      ['docs/ccc.md', 'docs/aaa.md', 'docs/bbb.md'],
    );
  });

  it('produces a heterogeneous plan over a mixed batch (bumped + refused + skipped + error)', () => {
    const bumped = makeNode({
      path: 'docs/stale.md',
      sidecar: {
        present: true,
        status: 'stale-body',
        annotations: { version: 1 },
      },
    });
    const refused = makeNode({
      path: 'docs/fresh-norefuse.md',
      sidecar: {
        present: true,
        status: 'fresh',
        annotations: { version: 1 },
      },
    });
    const escaping = makeNode({ path: '../sneaky.md' });

    const plan = computeBumpPlan([bumped, refused, escaping], { cwd: CWD, force: false });
    assert.equal(plan.items.length, 3);
    assert.equal(plan.items[0]!.status, 'bumped');
    assert.equal(plan.items[1]!.status, 'refused');
    assert.equal(plan.items[2]!.status, 'error');
  });
});
