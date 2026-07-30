/**
 * Coverage for `kernel/orchestrator/link-target-probe:makeLinkTargetProbe`.
 *
 * Behaviour pinned by these tests:
 *   - An existing file under a scan root probes `true`; a missing one
 *     probes `false`.
 *   - Multi-root: the probe tries every root and hits on any of them.
 *   - Relative roots anchor on `cwd`; absolute roots pass through.
 *   - Memoization: one filesystem observation per distinct target.
 *   - `lstat` semantics: a symlink ENTRY counts as existing even when
 *     dangling (never dereferenced, realpath-containment stance).
 *   - A directory target (trailing slash included) counts as existing.
 */

import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { makeLinkTargetProbe } from '../link-target-probe.js';

let tempRoot: string;
let cwd: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'link-target-probe-'));
  cwd = join(tempRoot, 'project');
  mkdirSync(cwd, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('makeLinkTargetProbe', () => {
  it('finds an existing file under the default root and misses an absent one', () => {
    writeFileSync(join(cwd, 'report.schema.json'), '{}');
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('report.schema.json'), true);
    assert.equal(probe('missing.json'), false);
  });

  it('resolves nested root-relative targets (the link.target convention)', () => {
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    writeFileSync(join(cwd, 'docs', 'diagram.png'), '');
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('docs/diagram.png'), true);
    assert.equal(probe('docs/other.png'), false);
  });

  it('refuses a target that escapes the scan root, even when the file EXISTS', () => {
    // The load-bearing case. `target` is authored inside a scanned file,
    // so under clone-and-scan it is attacker-controlled text. A real file
    // is planted OUTSIDE the root: an unguarded probe would stat it and
    // answer `true`, and that answer is readable from the scan output
    // (it decides whether the link reports `reference-broken`), which
    // makes the scan an existence oracle for the operator's filesystem.
    //
    // Asserting `false` against a file that genuinely exists is the only
    // way to prove containment rather than a coincidental miss.
    writeFileSync(join(tempRoot, 'outside.md'), 'secret');
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('../outside.md'), false, 'one level up must be refused');
    assert.equal(probe('../../../../../../etc/passwd.md'), false, 'deep escape must be refused');
  });

  it('does not accept a sibling whose name merely starts with the root name', () => {
    // The trailing-separator half of `isPathContained`. `<cwd>-evil` is
    // NOT inside `<cwd>`, but a bare `startsWith` comparison would say it
    // is, so a containment check written the obvious way leaks exactly
    // one directory: the one an attacker can create next to the project.
    const sibling = `${cwd}-evil`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'x.md'), '');
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('../project-evil/x.md'), false);
  });

  it('tries every root and hits on the second one', () => {
    const other = join(tempRoot, 'other');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'shared.json'), '{}');
    const probe = makeLinkTargetProbe(cwd, ['.', other]);
    assert.equal(probe('shared.json'), true);
  });

  it('anchors relative roots on cwd, not on process.cwd()', () => {
    const sibling = join(tempRoot, 'sibling');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'doc.md'), '');
    const probe = makeLinkTargetProbe(cwd, ['../sibling']);
    assert.equal(probe('doc.md'), true);
  });

  it('memoizes per target: one filesystem observation per distinct target', () => {
    const file = join(cwd, 'volatile.json');
    writeFileSync(file, '{}');
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('volatile.json'), true);
    // The entry disappears; the memoized verdict must survive within
    // the same probe instance (fresh probe per scan pass by contract).
    rmSync(file);
    assert.equal(probe('volatile.json'), true);
    const fresh = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(fresh('volatile.json'), false);
  });

  it('counts a dangling symlink entry as existing (lstat, never dereferenced)', () => {
    symlinkSync(join(tempRoot, 'nowhere'), join(cwd, 'dangling.json'));
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('dangling.json'), true);
  });

  it('counts a directory target as existing, trailing slash included', () => {
    mkdirSync(join(cwd, 'docs'), { recursive: true });
    const probe = makeLinkTargetProbe(cwd, ['.']);
    assert.equal(probe('docs'), true);
    assert.equal(probe('docs/'), true);
  });
});
