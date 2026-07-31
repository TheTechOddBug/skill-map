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
  // First consumer of `stdout-matches-schema`. Keeping it in the
  // in-repo subset matters more than usual: the assertion it exercises
  // spent its whole life declared-but-unimplemented precisely because
  // no case used it, so an unused assertion is the failure mode to
  // guard against, not just an untested one.
  'scan-result-schema',
  'project-config-schema',
  'plugins-doctor-schema',
  'extension-manifest-enable-gate',
  'refresh-report-schema',
  'catalog-slots-input-types',
  'bump-report-schema',
  'extension-kind-manifests',
  'elapsed-time-reporting',
  // The `capture` / `each` / `expectExit` / `schemaPointer` family. Same
  // reasoning as `scan-result-schema` above, and more acute: these four
  // fields exist to make a contract expressible, so a regression in the
  // runner would not fail any OTHER case, it would silently shrink what
  // the suite is able to say.
  'history-record-schema',
  'history-stats-schema',
  'job-document-schema',
  'record-nonce-mismatch',
  'record-report-schema-gate',
  'record-tags-report',
  'duplicate-submit-rejected',
  'force-does-not-duplicate-live-job',
  'plugin-manifest-schema',
  'record-findings-report',
  'record-findings-envelope-gate',
  'plugin-storage-prefix-enforced',
  'plugin-storage-namespace-rejected',
  'conformance-result-schema',
  // The server-capable trio (rows 25 / 36 / H). `serve-info-schema` and
  // `rest-envelope-schema` exercise `setup.serve` + `http-matches-schema`
  // (a server booted on an ephemeral port, torn down after assertions);
  // `record-run-envelope` exercises `ndjson-line` over `sm record --json`'s
  // stdout event stream. Same reasoning as the families above: these
  // primitives exist to make contracts expressible, so a runner
  // regression would not fail any OTHER case, it would silently shrink
  // what the suite can say.
  'serve-info-schema',
  'rest-envelope-schema',
  'record-run-envelope',
  // The concurrency + clock pair (rows C / G). `claim-race-atomicity`
  // exercises `invoke.parallel` (two overlapping claims, exactly one
  // handover); `ttl-reap-abandoned` exercises `sleepAfterMs` (a 3x-TTL
  // wait so the ride-along reap observably fails the expired job).
  // Together they add ~5s of wall-clock, accepted: the real race and the
  // real TTL expiry are the contracts, and there is no faster honest way
  // to observe either.
  'claim-race-atomicity',
  'ttl-reap-abandoned',
] as const;
const PROVIDER_CLAUDE_CASES = ['rename-high', 'orphan-detection'] as const;
const PROVIDER_OPENAI_CASES = ['basic-scan', 'body-links'] as const;
const PROVIDER_ANTIGRAVITY_CASES = ['basic-scan', 'workflow-links', 'reserved-names', 'at-file-references'] as const;

describe('conformance suite (Step 0b subset)', () => {
  for (const caseId of SPEC_CASES) {
    it(`spec case ${caseId} passes`, async () => {
      const result = await runConformanceCase({
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
    it(`provider:claude case ${caseId} passes`, async () => {
      const result = await runConformanceCase({
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
    it(`provider:codex case ${caseId} passes`, async () => {
      const result = await runConformanceCase({
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
    it(`provider:antigravity case ${caseId} passes`, async () => {
      const result = await runConformanceCase({
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

  it('rejects a case whose `fixture` escapes the fixtures root', async () => {
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

    await assert.rejects(
      () =>
        runConformanceCase({
          binary: BIN,
          specRoot: SPEC_ROOT,
          casePath,
          fixturesRoot: fixturesDir,
        }),
      (err: unknown) => {
        // The guard rejects before the child `sm` process is spawned,
        // catching here proves the runner refused the case JSON
        // without any I/O against the hostile path.
        assert.ok(err instanceof Error, `expected Error, got ${typeof err}`);
        assert.match(err.message, /escapes its anchor/);
        assert.match(err.message, /\.\.\/.*etc\/passwd/);
        return true;
      },
    );
  });

  it('refuses a schema assertion whose `path` or `schema` escapes its anchor', async () => {
    // The schema assertions were added long after this guard suite and
    // arrived without it, because the assertion they implement had been
    // a permanently-failing stub since Step 0: an assertion nobody could
    // run is also an assertion nobody could attack, so the gap was
    // invisible until it started working.
    //
    // A conformance runner is expected to execute cases it did NOT
    // author (that is the entire point of a portable suite), so a case's
    // `path` and `schema` are untrusted input exactly like a fixture
    // name. Unlike `fixture`, these are evaluated per assertion AFTER
    // the child ran, so they surface as a failed assertion rather than a
    // throw; asserting the reason is what proves the guard fired instead
    // of the read merely missing.
    const casesDir = join(tmpRoot, 'cases-schema-escape');
    const fixturesDir = join(tmpRoot, 'fixtures-schema-escape');
    mkdirSync(casesDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });

    const casePath = join(casesDir, 'hostile-schema-escape.json');
    writeFileSync(
      casePath,
      JSON.stringify({
        id: 'hostile-schema-escape',
        description: 'Hostile case pointing the schema assertions out of their anchors',
        invoke: { verb: 'scan', flags: ['--json'] },
        assertions: [
          { type: 'file-matches-schema', path: '../../../../etc/passwd', schema: 'node.schema.json' },
          { type: 'stdout-matches-schema', schema: '../../../../etc/passwd' },
        ],
      }),
    );

    const result = await runConformanceCase({
      binary: BIN,
      specRoot: SPEC_ROOT,
      casePath,
      fixturesRoot: fixturesDir,
    });

    assert.equal(result.passed, false);
    const failures = result.assertions.filter(
      (a): a is Extract<typeof a, { ok: false }> => !a.ok,
    );
    assert.equal(failures.length, 2, 'both escaping assertions must be refused');
    for (const failure of failures) {
      assert.match(failure.reason, /escapes its anchor/);
    }
  });

  it('rejects a case whose `fixture` is absolute', async () => {
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

    await assert.rejects(
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
