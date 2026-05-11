/**
 * Step 9.6.3 — `FilesystemSidecarStore.applyPatch` tests.
 *
 * Covers the four contract guarantees laid down in `kernel/sidecar/store.ts`:
 *
 *   1. Patch on a non-existent sidecar creates the file with valid content.
 *   2. Patch on an existing sidecar deep-merges (preserves untouched keys,
 *      including `<plugin-id>:` namespaced blocks).
 *   3. Concurrent `applyPatch` calls on the same path are serialised; both
 *      patches' effects survive (no lost write).
 *   4. A patch that produces a schema-invalid result throws and leaves the
 *      file unchanged on disk.
 *
 * The fixture root lives under `os.tmpdir()` in line with the other kernel
 * tests; `mkdtempSync` keeps each test isolated.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, ok, deepStrictEqual, rejects } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  FilesystemSidecarStore,
  _resetSidecarStoreValidatorCacheForTests,
  deepMerge,
} from '../kernel/sidecar/store.js';

const VALID_HASH_A = 'a'.repeat(64);
const VALID_HASH_B = 'b'.repeat(64);
const VALID_HASH_C = 'c'.repeat(64);

let tmpRoot: string;
let consentRoot: string;

/**
 * Consent bag for tests where the gate is not the subject — points at
 * a fixture cwd that has `allowEditSmFiles: true` pre-set so the
 * `.sm` write proceeds silently. Tests that exercise the gate itself
 * use their own fixture root + `confirm: false`.
 */
function consentBag(): { confirm: boolean; cwd: string; homedir: string } {
  return { confirm: false, cwd: consentRoot, homedir: consentRoot };
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'sm-sidecar-store-'));
  // Per-test-suite consent root with the flag pre-granted, so the
  // store's pre-flight gate passes without rewriting consent on every
  // call.
  consentRoot = mkdtempSync(join(tmpdir(), 'sm-sidecar-consent-'));
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

describe('deepMerge', () => {
  it('recurses into nested objects', () => {
    const out = deepMerge(
      { a: { x: 1, y: 2 }, b: 'keep' },
      { a: { y: 9, z: 3 } },
    );
    deepStrictEqual(out, { a: { x: 1, y: 9, z: 3 }, b: 'keep' });
  });

  it('arrays are replaced, not element-merged', () => {
    const out = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    deepStrictEqual(out, { list: [9] });
  });

  it('does not mutate inputs', () => {
    const base = { a: { x: 1 } };
    const patch = { a: { y: 2 } };
    deepMerge(base, patch);
    deepStrictEqual(base, { a: { x: 1 } });
    deepStrictEqual(patch, { a: { y: 2 } });
  });

  it('treats `null` in the patch as a delete sentinel for existing keys', () => {
    const out = deepMerge(
      { audit: { lastBumpedAt: 't0', perWriteNote: 'old note' } },
      { audit: { lastBumpedAt: 't1', perWriteNote: null } },
    );
    deepStrictEqual(out, { audit: { lastBumpedAt: 't1' } });
  });

  it('skips `null` keys absent from the base (no literal-null persistence)', () => {
    const out = deepMerge(
      { audit: { lastBumpedAt: 't0' } },
      { audit: { lastBumpedAt: 't1', perWriteNote: null } },
    );
    deepStrictEqual(out, { audit: { lastBumpedAt: 't1' } });
  });
});

describe('FilesystemSidecarStore.applyPatch', () => {
  it('creates a new sidecar when the file is absent', async () => {
    const store = new FilesystemSidecarStore();
    const target = join(tmpRoot, 'create.sm');
    ok(!existsSync(target));

    await store.applyPatch(target, {
      identity: {
        path: 'foo.md',
        bodyHash: VALID_HASH_A,
        frontmatterHash: VALID_HASH_B,
      },
      annotations: { version: 1 },
      audit: { lastBumpedAt: '2026-05-05T10:00:00Z', lastBumpedBy: 'cli' },
    }, consentBag());

    ok(existsSync(target));
    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const identityBlock = parsed['identity'] as Record<string, unknown>;
    strictEqual(identityBlock['bodyHash'], VALID_HASH_A);
    strictEqual((parsed['annotations'] as Record<string, unknown>)['version'], 1);
  });

  it('deep-merges into an existing sidecar, preserving plugin namespaces', async () => {
    const store = new FilesystemSidecarStore();
    const target = join(tmpRoot, 'merge.sm');

    // Seed the file with plugin-namespaced data + an existing version.
    const seed = {
      identity: {
        path: 'foo.md',
        bodyHash: VALID_HASH_A,
        frontmatterHash: VALID_HASH_B,
      },
      annotations: { version: 1, stability: 'stable' },
      'example-plugin': { customField: 'original-value', extra: { nested: 1 } },
    };
    writeFileSync(target, yaml.dump(seed), { encoding: 'utf8' });

    await store.applyPatch(target, {
      annotations: { version: 2 },
      audit: { lastBumpedAt: '2026-05-05T10:00:00Z', lastBumpedBy: 'cli' },
    }, consentBag());

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const annotations = parsed['annotations'] as Record<string, unknown>;
    // Bumped version.
    strictEqual(annotations['version'], 2);
    // Untouched annotation preserved.
    strictEqual(annotations['stability'], 'stable');
    // Plugin namespace untouched.
    deepStrictEqual(parsed['example-plugin'], {
      customField: 'original-value',
      extra: { nested: 1 },
    });
    // Audit added.
    const audit = parsed['audit'] as Record<string, unknown>;
    strictEqual(audit['lastBumpedBy'], 'cli');
  });

  it('serialises concurrent applyPatch calls on the same path (no lost write)', async () => {
    const store = new FilesystemSidecarStore();
    const target = join(tmpRoot, 'concurrent.sm');

    // Seed.
    writeFileSync(
      target,
      yaml.dump({
        identity: {
          path: 'foo.md',
          bodyHash: VALID_HASH_A,
          frontmatterHash: VALID_HASH_B,
        },
        annotations: { version: 1 },
      }),
    );

    const a = store.applyPatch(target, {
      annotations: { version: 2 },
      audit: { lastBumpedAt: '2026-05-05T10:00:00Z', lastBumpedBy: 'cli-a' },
    }, consentBag());
    const b = store.applyPatch(target, {
      audit: { secondWriterTag: 'second writer' },
    }, consentBag());
    await Promise.all([a, b]);

    const parsed = yaml.load(readFileSync(target, 'utf8')) as Record<string, unknown>;
    const annotations = parsed['annotations'] as Record<string, unknown>;
    const audit = parsed['audit'] as Record<string, unknown>;
    // Version from the first patch survived.
    strictEqual(annotations['version'], 2);
    // lastBumpedBy from the first patch is still there (deep-merged).
    strictEqual(audit['lastBumpedBy'], 'cli-a');
    // The second patch's free-form key is also there — so neither write was lost.
    strictEqual(audit['secondWriterTag'], 'second writer');
  });

  it('throws and leaves the file unchanged when the merged result is schema-invalid', async () => {
    const store = new FilesystemSidecarStore();
    const target = join(tmpRoot, 'invalid.sm');

    const seed = {
      identity: {
        path: 'foo.md',
        bodyHash: VALID_HASH_A,
        frontmatterHash: VALID_HASH_B,
      },
      annotations: { version: 1 },
    };
    const seedYaml = yaml.dump(seed);
    writeFileSync(target, seedYaml);

    await rejects(
      () =>
        store.applyPatch(target, {
          // bodyHash with bad pattern — will fail schema validation.
          identity: { bodyHash: 'not-a-sha256' },
        }, consentBag()),
      /schema-invalid/,
    );

    // File contents must be unchanged byte-for-byte.
    strictEqual(readFileSync(target, 'utf8'), seedYaml);
  });

  it('leaves no `.tmp` file behind on the success path', async () => {
    const store = new FilesystemSidecarStore();
    const target = join(tmpRoot, 'no-tmp.sm');
    await store.applyPatch(target, {
      identity: {
        path: 'foo.md',
        bodyHash: VALID_HASH_C,
        frontmatterHash: VALID_HASH_A,
      },
    }, consentBag());
    ok(!existsSync(`${target}.tmp`), 'sibling .tmp file should not survive');
  });

  it('throws EConsentRequiredError when allowEditSmFiles is false and confirm is false', async () => {
    const store = new FilesystemSidecarStore();
    const gateRoot = mkdtempSync(join(tmpdir(), 'sm-sidecar-gate-'));
    const target = join(gateRoot, 'gated.sm');
    const { EConsentRequiredError } = await import('../core/config/sidecar-consent.js');
    await rejects(
      () =>
        store.applyPatch(target, {
          identity: {
            path: 'foo.md',
            bodyHash: VALID_HASH_A,
            frontmatterHash: VALID_HASH_B,
          },
        }, { confirm: false, cwd: gateRoot, homedir: gateRoot }),
      EConsentRequiredError,
    );
    // No file was written.
    ok(!existsSync(target), 'consent failure must not create the .sm file');
    rmSync(gateRoot, { recursive: true, force: true });
  });

  it('persists the consent flag flip to settings.local.json on confirm:true', async () => {
    const store = new FilesystemSidecarStore();
    const gateRoot = mkdtempSync(join(tmpdir(), 'sm-sidecar-gate-confirm-'));
    const target = join(gateRoot, 'confirmed.sm');
    await store.applyPatch(target, {
      identity: {
        path: 'foo.md',
        bodyHash: VALID_HASH_A,
        frontmatterHash: VALID_HASH_B,
      },
    }, { confirm: true, cwd: gateRoot, homedir: gateRoot });
    ok(existsSync(target), '.sm file should be created after confirm:true');
    // The gate must have persisted the flag flip to project-local.
    const localPath = join(gateRoot, '.skill-map', 'settings.local.json');
    ok(existsSync(localPath), 'settings.local.json should now exist');
    const persisted = JSON.parse(readFileSync(localPath, 'utf8')) as Record<string, unknown>;
    strictEqual(persisted['allowEditSmFiles'], true);
    rmSync(gateRoot, { recursive: true, force: true });
  });
});
