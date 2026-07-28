/**
 * Unit coverage for the scope anchor (audit C1 / H1).
 *
 * Two properties carry the whole mechanism, and both have a test that
 * fails loudly if someone "simplifies" them away:
 *
 *   1. A grant minted against one scope must not verify against another.
 *      That is the clone case in one line.
 *   2. Grants are per SUBJECT. Minting one for `legit` must do nothing
 *      for `evil`. A per-store stamp was the original design and it was
 *      exploitable: any legitimate write refreshed it and blessed every
 *      unrelated row sitting in the same store.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  computeScopeGrant,
  readScopeAnchor,
  verifyScopeGrant,
  type TScopeAnchor,
} from '../scope-anchor.js';

const skipSymlinkTests = platform() === 'win32';

let scratch: string;

/** A scope directory that exists, with its real anchor. */
function freshScope(name: string): { dir: string; anchor: TScopeAnchor } {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return { dir, anchor: readScopeAnchor(dir) };
}

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sm-scope-anchor-'));
});

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('readScopeAnchor', () => {
  it('reads a real directory, with a non-zero birth time', () => {
    const { anchor } = freshScope('live');
    assert.equal(anchor.kind, 'value');
    if (anchor.kind !== 'value') return;
    assert.notEqual(anchor.birthtimeNs, 0n);
    assert.notEqual(anchor.ino, 0n);
  });

  it('reports a missing directory as absent rather than throwing', () => {
    assert.deepEqual(readScopeAnchor(join(scratch, 'nope')), { kind: 'absent' });
  });

  it('reports a regular file as absent', () => {
    const f = join(scratch, 'not-a-dir');
    writeFileSync(f, 'x\n');
    assert.deepEqual(readScopeAnchor(f), { kind: 'absent' });
  });

  it('two sibling scopes never share an anchor', () => {
    const a = freshScope('sib-a').anchor;
    const b = freshScope('sib-b').anchor;
    assert.equal(a.kind, 'value');
    assert.equal(b.kind, 'value');
    if (a.kind !== 'value' || b.kind !== 'value') return;
    assert.notEqual(a.ino, b.ino);
  });

  it('is stable across writes into the directory, which is why it anchors', () => {
    // The atomic writer replaces FILE inodes on every write. Anchoring on
    // the directory is what makes a grant survive an ordinary config save.
    const { dir, anchor } = freshScope('stable');
    writeFileSync(join(dir, 'settings.local.json'), '{}\n');
    writeFileSync(join(dir, 'settings.local.json.tmp'), '{}\n');
    rmSync(join(dir, 'settings.local.json.tmp'));
    assert.deepEqual(readScopeAnchor(dir), anchor);
  });

  it('follows a symlinked scope, so a link to a birthtime-less path is UNUSABLE, never a weaker fallback', { skip: skipSymlinkTests }, () => {
    // `/proc` reports birthtime 0. A committed `.skill-map -> /proc`
    // would select the degraded arm on demand if one existed; there is
    // none, so it lands on `unusable` and every grant is refused.
    const link = join(scratch, 'proc-link');
    try {
      symlinkSync('/proc', link);
    } catch {
      return; // no /proc on this platform
    }
    const anchor = readScopeAnchor(link);
    assert.ok(anchor.kind === 'unusable' || anchor.kind === 'absent', `got ${anchor.kind}`);
  });
});

describe('computeScopeGrant', () => {
  it('mints nothing without a usable anchor', () => {
    for (const anchor of [
      { kind: 'absent' } as const,
      { kind: 'unusable', reason: 'no-birthtime' } as const,
    ]) {
      assert.equal(computeScopeGrant(anchor, 'plugin-trust', 'p', true), null);
    }
  });

  it('separates subjects, the property that kills store-wide blessing', () => {
    const { anchor } = freshScope('subjects');
    const legit = computeScopeGrant(anchor, 'plugin-trust', 'legit', true);
    const evil = computeScopeGrant(anchor, 'plugin-trust', 'evil', true);
    assert.notEqual(legit, null);
    assert.notEqual(legit, evil);
    // Holding a grant for one subject must not verify another.
    assert.equal(verifyScopeGrant(anchor, 'plugin-trust', 'evil', legit, true), false);
  });

  it('separates namespaces for the same subject', () => {
    const { anchor } = freshScope('namespaces');
    const a = computeScopeGrant(anchor, 'plugin-trust', 'x', true);
    const b = computeScopeGrant(anchor, 'local-config', 'x', true);
    assert.notEqual(a, b);
  });

  it('binds the value, so editing a granted key on disk invalidates it', () => {
    const { anchor } = freshScope('values');
    const granted = computeScopeGrant(anchor, 'local-config', 'scan.followExternalSymlinks', false);
    assert.equal(
      verifyScopeGrant(anchor, 'local-config', 'scan.followExternalSymlinks', granted, true),
      false,
    );
  });

  it('is length-framed, so subject and value cannot be shifted across the join', () => {
    const { anchor } = freshScope('framing');
    assert.notEqual(
      computeScopeGrant(anchor, 'local-config', 'ab', 'c'),
      computeScopeGrant(anchor, 'local-config', 'a', 'bc'),
    );
  });

  it('refuses to mint for a non-canonical value', () => {
    const { anchor } = freshScope('canon');
    // Objects do not serialise deterministically; every real
    // PROJECT_LOCAL_ONLY_KEYS value is a scalar or an array of scalars.
    assert.equal(computeScopeGrant(anchor, 'local-config', 'k', { a: 1 }), null);
    assert.notEqual(computeScopeGrant(anchor, 'local-config', 'k', ['a', 'b']), null);
  });
});

describe('verifyScopeGrant', () => {
  it('accepts a grant minted against the same scope', () => {
    const { anchor } = freshScope('accept');
    const grant = computeScopeGrant(anchor, 'plugin-trust', 'p', true);
    assert.equal(verifyScopeGrant(anchor, 'plugin-trust', 'p', grant, true), true);
  });

  it('REFUSES a grant minted against a different scope, the clone case', () => {
    const theirs = freshScope('theirs').anchor;
    const mine = freshScope('mine').anchor;
    const shipped = computeScopeGrant(theirs, 'plugin-trust', 'evil', true);
    assert.equal(verifyScopeGrant(mine, 'plugin-trust', 'evil', shipped, true), false);
  });

  it('REFUSES a missing grant as firmly as a wrong one', () => {
    // Pre-mechanism state and an attacker who simply omits the grant are
    // indistinguishable here, so grandfathering would be a one-line bypass.
    const { anchor } = freshScope('missing');
    for (const recorded of [null, undefined, '']) {
      assert.equal(verifyScopeGrant(anchor, 'plugin-trust', 'p', recorded, true), false);
    }
  });

  it('refuses everything when the anchor is unusable, with no ino-only fallback', () => {
    const unusable = { kind: 'unusable', reason: 'no-birthtime' } as const;
    assert.equal(verifyScopeGrant(unusable, 'plugin-trust', 'p', 'deadbeef', true), false);
  });
});
