import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runConformanceCase } from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(WORKSPACE, '..');
const SPEC_ROOT = resolve(REPO_ROOT, 'spec');
const BIN = resolve(WORKSPACE, 'bin', 'sm.js');

const SPEC_CASES_DIR = resolve(SPEC_ROOT, 'conformance', 'cases');
const SPEC_FIXTURES_DIR = resolve(SPEC_ROOT, 'conformance', 'fixtures');

const CLAUDE_CONFORMANCE_DIR = resolve(
  WORKSPACE,
  'plugins',
  'claude',
  'providers',
  'claude',
  'conformance',
);
const CLAUDE_CASES_DIR = resolve(CLAUDE_CONFORMANCE_DIR, 'cases');
const CLAUDE_FIXTURES_DIR = resolve(CLAUDE_CONFORMANCE_DIR, 'fixtures');

const OPENAI_CONFORMANCE_DIR = resolve(
  WORKSPACE,
  'plugins',
  'codex',
  'providers',
  'codex',
  'conformance',
);
const OPENAI_CASES_DIR = resolve(OPENAI_CONFORMANCE_DIR, 'cases');
const OPENAI_FIXTURES_DIR = resolve(OPENAI_CONFORMANCE_DIR, 'fixtures');

const ANTIGRAVITY_CONFORMANCE_DIR = resolve(
  WORKSPACE,
  'plugins',
  'antigravity',
  'providers',
  'antigravity',
  'conformance',
);
const ANTIGRAVITY_CASES_DIR = resolve(ANTIGRAVITY_CONFORMANCE_DIR, 'cases');
const ANTIGRAVITY_FIXTURES_DIR = resolve(ANTIGRAVITY_CONFORMANCE_DIR, 'fixtures');

/**
 * Step 0b reference subset, post-A.13 split:
 *
 *   - `kernel-empty-boot` is kernel-agnostic and stays in `spec/`.
 *   - `rename-high` and `orphan-detection` exercise the Claude Provider's
 *     kind catalog (`skill`) and now live with the Provider at
 *     `src/extensions/providers/claude/conformance/`.
 *
 * The runner is the same; only the case + fixtures roots change. This
 * test composes both into a single suite so CI exercises spec + Provider
 * conformance in one go (same as what `sm conformance run --scope all`
 * delivers to external consumers).
 */
const SPEC_CASES = [
  'kernel-empty-boot',
  'score-phase-confidence',
  'preamble-bitwise-match',
  'extension-mode-routing',
  'extension-mode-routing-deterministic',
] as const;
const PROVIDER_CLAUDE_CASES = ['rename-high', 'orphan-detection'] as const;
const PROVIDER_OPENAI_CASES = ['basic-scan', 'body-links'] as const;
const PROVIDER_ANTIGRAVITY_CASES = ['basic-scan', 'workflow-links', 'reserved-names', 'at-file-references'] as const;

describe('conformance suite (Step 0b subset)', () => {
  for (const caseId of SPEC_CASES) {
    it(`spec case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(SPEC_CASES_DIR, `${caseId}.json`),
        fixturesRoot: SPEC_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `spec case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }

  for (const caseId of PROVIDER_CLAUDE_CASES) {
    it(`provider:claude case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(CLAUDE_CASES_DIR, `${caseId}.json`),
        fixturesRoot: CLAUDE_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `provider:claude case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }

  for (const caseId of PROVIDER_OPENAI_CASES) {
    it(`provider:codex case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(OPENAI_CASES_DIR, `${caseId}.json`),
        fixturesRoot: OPENAI_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `provider:codex case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }

  for (const caseId of PROVIDER_ANTIGRAVITY_CASES) {
    it(`provider:antigravity case ${caseId} passes`, () => {
      const result = runConformanceCase({
        binary: BIN,
        specRoot: SPEC_ROOT,
        casePath: resolve(ANTIGRAVITY_CASES_DIR, `${caseId}.json`),
        fixturesRoot: ANTIGRAVITY_FIXTURES_DIR,
      });
      const failures = result.assertions.filter(
        (a): a is Extract<typeof a, { ok: false }> => !a.ok,
      );
      const summary = failures.length
        ? failures.map((f) => `  - [${f.type}] ${f.reason}`).join('\n')
        : '';
      assert.ok(
        result.passed,
        `provider:antigravity case ${caseId} failed\n${summary}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    });
  }
});

/**
 * Audit follow-up (cli-architect re-audit, finding 6.4): the runner
 * gates `case.fixture`, `setup.priorScans[].fixture`, and the per-
 * assertion `path` / `fixture` fields through `assertContained` to
 * stop a hostile case JSON from copying arbitrary filesystem content
 * into the tmp scope or asserting against files outside the
 * conformance sandbox. The unit-level guard is exercised by
 * `assertContained` itself; this top-level test plants a hostile case
 * JSON and verifies the runner refuses it before any I/O against the
 * planted path occurs.
 */
describe('runConformanceCase, path-traversal guard (audit follow-up 6.4)', () => {
  let tmpRoot: string;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-conformance-traversal-'));
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects a case whose `fixture` escapes the fixtures root', () => {
    const casesDir = join(tmpRoot, 'cases');
    const fixturesDir = join(tmpRoot, 'fixtures');
    mkdirSync(casesDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });

    const casePath = join(casesDir, 'hostile-traversal.json');
    writeFileSync(
      casePath,
      JSON.stringify({
        id: 'hostile-traversal',
        description: 'Hostile case that tries to point at /etc/passwd',
        fixture: '../../../../../../etc/passwd',
        invoke: { verb: 'scan', flags: ['--json'] },
        assertions: [{ type: 'exit-code', value: 0 }],
      }),
    );

    assert.throws(
      () =>
        runConformanceCase({
          binary: BIN,
          specRoot: SPEC_ROOT,
          casePath,
          fixturesRoot: fixturesDir,
        }),
      (err: unknown) => {
        // The guard throws before the child `sm` process is spawned,
        // catching here proves the runner refused the case JSON
        // without any I/O against the hostile path.
        assert.ok(err instanceof Error, `expected Error, got ${typeof err}`);
        assert.match(err.message, /escapes its anchor/);
        assert.match(err.message, /\.\.\/.*etc\/passwd/);
        return true;
      },
    );
  });

  it('rejects a case whose `fixture` is absolute', () => {
    const casesDir = join(tmpRoot, 'cases-absolute');
    const fixturesDir = join(tmpRoot, 'fixtures-absolute');
    mkdirSync(casesDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });

    const casePath = join(casesDir, 'hostile-absolute.json');
    writeFileSync(
      casePath,
      JSON.stringify({
        id: 'hostile-absolute',
        description: 'Hostile case with an absolute fixture path',
        fixture: '/etc/passwd',
        invoke: { verb: 'scan', flags: ['--json'] },
        assertions: [{ type: 'exit-code', value: 0 }],
      }),
    );

    assert.throws(
      () =>
        runConformanceCase({
          binary: BIN,
          specRoot: SPEC_ROOT,
          casePath,
          fixturesRoot: fixturesDir,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /must be relative to its anchor/);
        return true;
      },
    );
  });
});
