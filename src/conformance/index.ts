/**
 * Contract runner, executes the conformance cases shipped with
 * `@skill-map/spec` against an installed binary and emits a pass/fail result
 * per case.
 *
 * Implements the assertion types from `spec/schemas/conformance-case.schema.json`.
 * Provisions a clean tmp scope per case, optionally pre-populated with the
 * referenced fixture corpus. `setup.serve` cases additionally boot the
 * implementation's server on an ephemeral port and keep it alive through
 * assertion evaluation (the `http-matches-schema` target), torn down with
 * an awaited SIGTERM/SIGKILL so the child never outlives the case.
 *
 * Step 0b scope: single-case dispatch. Suite-level runner + reporter land
 * alongside Step 2 extensions.
 */

import { grantTrust } from '../kernel/config/plugin-trust-store.js';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { defaultServeInfoPath, SERVE_INFO_FILENAME } from '../core/paths/db-path.js';

import { formatErrorMessage } from '../kernel/util/format-error.js';
import { KERNEL_SKILL_MAP_DIR } from '../kernel/util/skill-map-paths.js';
import { tx } from '../kernel/util/tx.js';
import { CONFORMANCE_RUNNER_TEXTS } from './i18n/runner.texts.js';
import { checkAgainstSchema, parseJsonForSchema } from './schema-assertions.js';

export type TAssertionResult =
  | { ok: true; type: string }
  | { ok: false; type: string; reason: string };

export interface IRunCaseResult {
  caseId: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  assertions: TAssertionResult[];
}

export interface IRunCaseOptions {
  /** Absolute path to the binary wrapper (e.g. `bin/sm.js`). */
  binary: string;
  /** Absolute path to the `@skill-map/spec` root. */
  specRoot: string;
  /** Absolute path to the case JSON under `<conformance-root>/cases/`. */
  casePath: string;
  /**
   * Absolute path to the `<conformance-root>/fixtures/` directory backing
   * this case (or the parent conformance suite).
   *
   * Phase 5 / A.13 introduced per-Provider conformance directories that
   * live outside the spec tree (Claude-specific cases moved to
   * `src/extensions/providers/claude/conformance/`). Cases reference
   * fixtures by directory name; the runner resolves them under
   * `fixturesRoot` so the spec-agnostic kernel-empty-boot case and the
   * Claude `basic-scan` / `rename-high` / `orphan-detection` cases can
   * coexist without colliding fixture namespaces. Defaults to
   * `<specRoot>/conformance/fixtures` for the legacy spec layout.
   */
  fixturesRoot?: string;
  /** Extra env vars passed to the child. */
  env?: NodeJS.ProcessEnv;
}

/** `invoke` shape (`conformance-case.schema.json#/$defs/Invocation`). */
interface IInvocation {
  verb: string;
  sub?: string;
  args?: string[];
  flags?: string[];
}

/**
 * `setup.priorInvokes[N]` shape
 * (`conformance-case.schema.json#/$defs/StagedInvocation`), an invocation
 * plus the two staging-only controls.
 */
interface IStagedInvocation extends IInvocation {
  /** Exit code this step MUST return; defaults to 0. */
  expectExit?: number;
  /** Variable name to JSONPath, extracted from this step's stdout. */
  capture?: Record<string, string>;
}

/** Accumulated `capture` bindings, variable name to captured value. */
type TCaptures = Record<string, string>;

interface IConformanceCase {
  id: string;
  description: string;
  fixture?: string;
  setup?: {
    disableAllProviders?: boolean;
    disableAllExtractors?: boolean;
    disableAllAnalyzers?: boolean;
    /**
     * Start the implementation's server (`sm serve`) on an ephemeral
     * port inside the scope, kept alive through the main `invoke` AND
     * assertion evaluation (so `http-matches-schema` has a target and
     * `file-matches-schema` can observe `serve.json`), then torn down.
     */
    serve?: boolean;
    priorScans?: Array<{ fixture: string; flags?: string[] }>;
    priorInvokes?: IStagedInvocation[];
  };
  invoke: IInvocation;
  assertions: TAssertion[];
}

/**
 * Flatten an invocation into the argv tail passed to the binary,
 * substituting `{{name}}` placeholders from earlier `capture` steps.
 *
 * Substitution covers `args` and `flags` only. `verb` and `sub` are left
 * literal on purpose: a captured value is CLI output, and letting it
 * choose which command runs would turn any implementation that echoes
 * attacker-controlled content into a way to redirect the invocation.
 *
 * Throws on an unresolved placeholder rather than passing it through.
 * A literal `{{nonce}}` reaching the CLI surfaces as a puzzling
 * credential rejection several steps downstream; naming the missing
 * capture points at the actual mistake.
 */
function invocationArgv(invoke: IInvocation, captures: TCaptures = {}): string[] {
  const argv = [invoke.verb];
  if (invoke.sub) argv.push(invoke.sub);
  const substitute = (value: string): string =>
    value.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_match, name: string) => {
      const bound = captures[name];
      if (bound === undefined) {
        throw new Error(tx(CONFORMANCE_RUNNER_TEXTS.unboundPlaceholder, { name }));
      }
      return bound;
    });
  if (invoke.args) argv.push(...invoke.args.map(substitute));
  if (invoke.flags) argv.push(...invoke.flags.map(substitute));
  return argv;
}

/**
 * `invocationArgv` as a discriminated union rather than a throw, so both
 * call sites (staging steps and the main invoke) report an unresolved
 * placeholder as a case failure instead of unwinding the runner.
 */
function resolveArgv(
  invoke: IInvocation,
  captures: TCaptures,
): { ok: true; argv: string[] } | { ok: false; reason: string } {
  try {
    return { ok: true, argv: invocationArgv(invoke, captures) };
  } catch (err) {
    return { ok: false, reason: formatErrorMessage(err) };
  }
}

/**
 * Build the env-var bag a case's `setup.disableAll*` toggles inject into
 * every child invocation (priorScans + the main `invoke`). The CLI's scan
 * composer (`composeScanExtensions`) reads these vars and drops every
 * extension of the matching kind from the in-scan pipeline.
 */
function disableEnv(setup: IConformanceCase['setup']): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (setup?.disableAllProviders) env['SKILL_MAP_DISABLE_ALL_PROVIDERS'] = '1';
  if (setup?.disableAllExtractors) env['SKILL_MAP_DISABLE_ALL_EXTRACTORS'] = '1';
  if (setup?.disableAllAnalyzers) env['SKILL_MAP_DISABLE_ALL_ANALYZERS'] = '1';
  return env;
}

/**
 * Allow-list of `process.env` keys propagated to the conformance child
 * (audit M5). The historical `{ ...process.env, ... }` spread leaked
 * every env var the runner inherited (`NPM_TOKEN`, `AWS_*`, etc.) into
 * a child that may execute case-author-controlled scan extensions, the
 * conformance contract assumes the spec is trusted, but the runner is
 * also used to validate forks / forks-of-forks where that assumption
 * relaxes. The closed list below covers exactly what a spawned `sm`
 * needs to find its toolchain (`PATH`), resolve `~/...` (`HOME`,
 * `USERPROFILE`), pick a tmpdir (`TMPDIR` / `TMP` / `TEMP`), reach
 * Windows shells (`SystemRoot`, `COMSPEC`, etc.), respect Node knobs
 * (`NODE_OPTIONS`, `NODE_PATH`, ...), honour locale (`LANG`,
 * `LC_*` covered by the prefix matcher), and render the CLI's
 * presentation knobs (`NO_COLOR`, `FORCE_COLOR`, `CI`, terminal). Any
 * skill-map-internal env var (`SKILL_MAP_*` / `SM_*`) is also forwarded
 * via the prefix matcher so the kill-switches and feature flags reach
 * the child unchanged.
 */
const SAFE_CONFORMANCE_ENV_KEYS: ReadonlyArray<string> = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'SystemDrive',
  'OS',
  'COMSPEC',
  'PATHEXT',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_NO_WARNINGS',
  'NODE_DEBUG',
  'LANG',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
];

const SAFE_CONFORMANCE_ENV_PREFIXES: ReadonlyArray<string> = [
  'LC_',
  'SKILL_MAP_',
  'SM_',
];

function pickSafeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CONFORMANCE_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  for (const key of Object.keys(source)) {
    if (out[key] !== undefined) continue;
    for (const prefix of SAFE_CONFORMANCE_ENV_PREFIXES) {
      if (key.startsWith(prefix)) {
        const value = source[key];
        if (value !== undefined) out[key] = value;
        break;
      }
    }
  }
  return out;
}

export type TAssertion =
  | { type: 'exit-code'; value: number }
  | {
      type: 'json-path';
      path: string;
      equals?: unknown;
      greaterThan?: number;
      lessThan?: number;
      matches?: string;
    }
  | { type: 'file-exists'; path: string }
  | { type: 'file-contains-verbatim'; path: string; fixture: string }
  | { type: 'stdout-contains-verbatim'; fixture: string }
  | { type: 'file-matches-schema'; path: string; schema: string; schemaPointer?: string; each?: boolean }
  | { type: 'stdout-matches-schema'; schema: string; schemaPointer?: string; each?: boolean }
  | {
      type: 'http-matches-schema';
      request: { path: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' };
      status?: number;
      schema: string;
      schemaPointer?: string;
      each?: boolean;
    }
  | {
      type: 'ndjson-line';
      match: Record<string, unknown>;
      path?: string;
      equals?: unknown;
      greaterThan?: number;
      lessThan?: number;
      matches?: string;
    }
  | { type: 'stderr-matches'; pattern: string };

// Conformance runner orchestrates: case parse, setup steps, scope
// provision, serve lifecycle, sm invocation, assert dispatch over the
// closed assertion type union. Each step is one cyclomatic point;
// splitting hides the pipeline.
export async function runConformanceCase(options: IRunCaseOptions): Promise<IRunCaseResult> {
  const raw = readFileSync(options.casePath, 'utf8');
  const c: IConformanceCase = JSON.parse(raw);

  const fixturesRoot = options.fixturesRoot ?? join(options.specRoot, 'conformance', 'fixtures');

  // Defence in depth (audit L5): the conformance case id is JSON-author-
  // controlled. Replace anything that isn't a safe filesystem char and
  // cap the length so an over-long id (or one carrying path separators
  // / control bytes) can't escape `tmpdir()` or grow the prefix beyond
  // a reasonable bound.
  const safeId = c.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const scope = mkdtempSync(join(tmpdir(), `sm-conformance-${safeId}-`));
  const setupEnv = disableEnv(c.setup);
  try {
    // 1. Replay every `setup.priorScans` step into the scope DB before
    //    the main invoke runs. Returns the failure result early if any
    //    step exits non-zero.
    const priorFailure = runPriorScansSetup(c, options, scope, fixturesRoot, setupEnv);
    if (priorFailure) return priorFailure;

    // 2. Copy the main fixture (replacing prior fixture content but
    //    preserving the DB), then run the case's `invoke`.
    if (c.fixture) {
      replaceFixture(scope, fixturesRoot, c.fixture);
    }

    // 2b. Grant local import-trust to the fixture's drop-in plugins.
    //     A conformance fixture is a controlled, trusted input (the suite
    //     author ships the plugin to be exercised), the analog of an
    //     explicit `--plugin-dir`, NOT a hostile cloned repo, so the
    //     default-disabled import-trust gate would otherwise leave every
    //     plugin-bearing case's plugin unexecuted. Runs AFTER the fixture
    //     is in place and BEFORE the invoke.
    grantFixturePluginTrust(scope);

    // 2c..3: serve lifecycle + prior invokes + main invoke, extracted so
    // the serve teardown has its own `finally` INSIDE this scope-removal
    // try (the child must be gone before `rmSync` runs).
    return await runServeAndInvokePhases(c, options, scope, setupEnv, fixturesRoot);
  } finally {
    rmSync(scope, { recursive: true, force: true });
  }
}

/**
 * Phases 2c..3 of `runConformanceCase`.
 *
 * 2c. `setup.serve`: boot the implementation's server on an ephemeral
 *     port, after fixture copy + plugin trust and BEFORE
 *     `setup.priorInvokes` (per the case schema). It stays up through
 *     the main invoke AND assertion evaluation, which is the point:
 *     `http-matches-schema` needs a live target and `file-matches-schema`
 *     may observe `serve.json`, a file that exists only while the server
 *     runs.
 * 2d. Replay every `setup.priorInvokes` step against the provisioned
 *     scope. Each step must exit 0 unless it declares `expectExit`, and
 *     may bind `capture` variables the later steps and the main invoke
 *     substitute into their argv.
 * 3.  Run the case's own `invoke` and evaluate its assertions.
 *
 * The serve teardown lives in this function's `finally`, AWAITED, so the
 * child can NEVER outlive the case (the no-leaked-processes rule applied
 * to the runner): SIGTERM first (clean shutdown removes `serve.json`),
 * SIGKILL if it lingers, and only then does the caller remove the scope.
 */
async function runServeAndInvokePhases(
  c: IConformanceCase,
  options: IRunCaseOptions,
  scope: string,
  setupEnv: NodeJS.ProcessEnv,
  fixturesRoot: string,
): Promise<IRunCaseResult> {
  let serve: IServeChild | null = null;
  try {
    let servePort: number | undefined;
    if (c.setup?.serve) {
      serve = spawnServeChild(options, scope, setupEnv);
      const ready = await awaitServeReady(c, serve, scope);
      if (!ready.ok) return ready.failure;
      servePort = ready.port;
    }

    const captures: TCaptures = {};
    const invokeFailure = runPriorInvokesSetup(c, options, scope, setupEnv, captures);
    if (invokeFailure) return invokeFailure;

    return await runMainInvoke(c, options, scope, setupEnv, fixturesRoot, captures, servePort);
  } finally {
    if (serve) await stopServeChild(serve.child);
  }
}

/**
 * Phase 3 of `runConformanceCase`, run the case's `invoke` against the
 * staged scope and evaluate every assertion against its streams.
 *
 * Assertions evaluate SEQUENTIALLY (a for-of, not `Promise.all`): the
 * report order must mirror the case's declared order, and parallel
 * `http-matches-schema` fetches against the same short-lived server
 * would trade determinism for nothing.
 */
async function runMainInvoke(
  c: IConformanceCase,
  options: IRunCaseOptions,
  scope: string,
  setupEnv: NodeJS.ProcessEnv,
  fixturesRoot: string,
  captures: TCaptures,
  servePort: number | undefined,
): Promise<IRunCaseResult> {
  const resolvedArgv = resolveArgv(c.invoke, captures);
  if (!resolvedArgv.ok) return stagingFailure(c, 0, '', '', resolvedArgv.reason);

  const child = spawnSync(process.execPath, [options.binary, ...resolvedArgv.argv], {
    cwd: scope,
    env: { ...pickSafeEnv(process.env), ...options.env, ...setupEnv },
    encoding: 'utf8',
  });

  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const exitCode = child.status ?? 0;

  const assertions: TAssertionResult[] = [];
  for (const a of c.assertions) {
    assertions.push(
      await evaluateAssertion(a, {
        exitCode,
        stdout,
        stderr,
        scope,
        specRoot: options.specRoot,
        fixturesRoot,
        servePort,
      }),
    );
  }
  const passed = assertions.every((a) => a.ok);

  return { caseId: c.id, passed, exitCode, stdout, stderr, assertions };
}

/**
 * Phase 1 of `runConformanceCase`, replay every `setup.priorScans`
 * step in order. Each step replaces every non-`.skill-map/` directory
 * with the named fixture, then runs `sm scan` so the snapshot persists
 * into the scope DB. The scope DB survives across steps (we never
 * delete `.skill-map/`).
 *
 * Returns `null` on success (caller continues) or a `IRunCaseResult`
 * with a single `priorScan` failure assertion (caller returns it
 * unchanged).
 */
// Per-step replay: replace fixture, spawn `sm scan`, check exit. The
// failure-result construction is verbose because it carries every
// stream the caller reports back.
// eslint-disable-next-line complexity
function runPriorScansSetup(
  c: IConformanceCase,
  options: IRunCaseOptions,
  scope: string,
  fixturesRoot: string,
  setupEnv: NodeJS.ProcessEnv,
): IRunCaseResult | null {
  for (const step of c.setup?.priorScans ?? []) {
    replaceFixture(scope, fixturesRoot, step.fixture);
    const stepArgv = ['scan', ...(step.flags ?? [])];
    const stepChild = spawnSync(process.execPath, [options.binary, ...stepArgv], {
      cwd: scope,
      env: { ...pickSafeEnv(process.env), ...options.env, ...setupEnv },
      encoding: 'utf8',
    });
    if ((stepChild.status ?? 0) !== 0) {
      return {
        caseId: c.id,
        passed: false,
        exitCode: stepChild.status ?? 0,
        stdout: stepChild.stdout ?? '',
        stderr: stepChild.stderr ?? '',
        assertions: [
          {
            ok: false,
            type: 'priorScan',
            reason: tx(CONFORMANCE_RUNNER_TEXTS.priorScanFailed, {
              fixture: step.fixture,
              exit: stepChild.status ?? 0,
              stderr: stepChild.stderr ?? '',
            }),
          },
        ],
      };
    }
  }
  return null;
}

/**
 * Phase 2c of `runConformanceCase`, replay every `setup.priorInvokes`
 * step in order against the fully-provisioned scope (top-level fixture
 * already copied, plugin trust granted). Unlike `priorScans` there is
 * no fixture swap: the steps mutate scope state through the CLI itself
 * (e.g. `sm jobs submit` before a `sm jobs preview --last` main invoke).
 *
 * Returns `null` on success (caller continues) or a `IRunCaseResult`
 * with a single `priorInvoke` failure assertion (caller returns it
 * unchanged).
 */
// Per-step replay: substitute, spawn, check exit, capture. The failure-
// result construction is verbose because it carries every stream the
// caller reports back (same shape as `runPriorScansSetup`).
// eslint-disable-next-line complexity
function runPriorInvokesSetup(
  c: IConformanceCase,
  options: IRunCaseOptions,
  scope: string,
  setupEnv: NodeJS.ProcessEnv,
  captures: TCaptures,
): IRunCaseResult | null {
  for (const step of c.setup?.priorInvokes ?? []) {
    const resolved = resolveArgv(step, captures);
    if (!resolved.ok) return stagingFailure(c, 0, '', '', resolved.reason);
    const stepArgv = resolved.argv;
    const stepChild = spawnSync(process.execPath, [options.binary, ...stepArgv], {
      cwd: scope,
      env: { ...pickSafeEnv(process.env), ...options.env, ...setupEnv },
      encoding: 'utf8',
    });
    const stepStdout = stepChild.stdout ?? '';
    const stepStderr = stepChild.stderr ?? '';
    const stepExit = stepChild.status ?? 0;
    // A step defaults to "must succeed"; `expectExit` is how a case
    // stages a REFUSAL (a duplicate submit that must be rejected before
    // the `--force` bypass can be asserted).
    const expected = step.expectExit ?? 0;
    if (stepExit !== expected) {
      return stagingFailure(
        c,
        stepExit,
        stepStdout,
        stepStderr,
        tx(CONFORMANCE_RUNNER_TEXTS.priorInvokeFailed, {
          argv: stepArgv.join(' '),
          expected,
          exit: stepExit,
          stderr: stepStderr,
        }),
      );
    }
    if (step.capture) {
      const bound = applyCaptures(step.capture, stepStdout, stepArgv);
      if (!bound.ok) return stagingFailure(c, stepExit, stepStdout, stepStderr, bound.reason);
      Object.assign(captures, bound.values);
    }
  }
  return null;
}

/** One-assertion failure result for a staging step, in the shape callers return unchanged. */
function stagingFailure(
  c: IConformanceCase,
  exitCode: number,
  stdout: string,
  stderr: string,
  reason: string,
): IRunCaseResult {
  return {
    caseId: c.id,
    passed: false,
    exitCode,
    stdout,
    stderr,
    assertions: [{ ok: false, type: 'priorInvoke', reason }],
  };
}

/** Readiness budget for `setup.serve`: the boot includes a scan, so it is generous. */
const SERVE_READY_TIMEOUT_MS = 15_000;
/** Poll cadence for `<scope>/.skill-map/serve.json` during serve boot. */
const SERVE_READY_POLL_MS = 150;
/** Grace window after SIGTERM before the SIGKILL fallback fires. */
const SERVE_SHUTDOWN_GRACE_MS = 5_000;
/** Relative label for the discovery file in failure messages. */
const SERVE_INFO_REL = `${KERNEL_SKILL_MAP_DIR}/${SERVE_INFO_FILENAME}`;

/** A running `setup.serve` child plus its captured boot streams. */
interface IServeChild {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
}

/**
 * Spawn the `setup.serve` server child: `sm serve --no-open --no-watcher
 * --port 0` with cwd=scope and the same env bag every other invocation
 * gets. `--no-watcher` is mandatory (no inotify watchers may spawn at
 * all) and `--port 0` binds an ephemeral port so parallel cases never
 * collide. Stdio is piped and CAPTURED so a boot failure is diagnosable
 * in the staging-failure reason instead of vanishing.
 */
function spawnServeChild(
  options: IRunCaseOptions,
  scope: string,
  setupEnv: NodeJS.ProcessEnv,
): IServeChild {
  const child = spawn(
    process.execPath,
    [options.binary, 'serve', '--no-open', '--no-watcher', '--port', '0'],
    {
      cwd: scope,
      env: { ...pickSafeEnv(process.env), ...options.env, ...setupEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let out = '';
  let err = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8');
  });
  return { child, stdout: () => out, stderr: () => err };
}

/**
 * Await server readiness: poll the scope's `serve.json` (the discovery
 * file the serve contract mandates, written AFTER the listener bound)
 * until it exists, parses, and carries an integer `port`. An early child
 * exit or the timeout is a staging failure carrying the captured stderr;
 * the caller's `finally` still tears the child down on the timeout path.
 */
async function awaitServeReady(
  c: IConformanceCase,
  serve: IServeChild,
  scope: string,
): Promise<{ ok: true; port: number } | { ok: false; failure: IRunCaseResult }> {
  const infoPath = defaultServeInfoPath(scope);
  const deadline = Date.now() + SERVE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serve.child.exitCode !== null || serve.child.signalCode !== null) {
      const exit = serve.child.exitCode ?? 0;
      return {
        ok: false,
        failure: stagingFailure(
          c,
          exit,
          serve.stdout(),
          serve.stderr(),
          tx(CONFORMANCE_RUNNER_TEXTS.serveExitedBeforeReady, {
            exit,
            file: SERVE_INFO_REL,
            stderr: serve.stderr(),
          }),
        ),
      };
    }
    const port = readServePort(infoPath);
    if (port !== null) return { ok: true, port };
    await delay(SERVE_READY_POLL_MS);
  }
  return {
    ok: false,
    failure: stagingFailure(
      c,
      0,
      serve.stdout(),
      serve.stderr(),
      tx(CONFORMANCE_RUNNER_TEXTS.serveNotReady, {
        file: SERVE_INFO_REL,
        timeout: SERVE_READY_TIMEOUT_MS,
        stderr: serve.stderr(),
      }),
    ),
  };
}

/**
 * One readiness probe: `serve.json` exists, parses, and holds an integer
 * `port`. Anything else (including a torn read, though the writer is
 * atomic by contract) reads as "not ready yet" and the poll retries.
 */
function readServePort(infoPath: string): number | null {
  if (!existsSync(infoPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(infoPath, 'utf8')) as { port?: unknown };
    return typeof parsed.port === 'number' && Number.isInteger(parsed.port) ? parsed.port : null;
  } catch {
    return null;
  }
}

/**
 * Tear the serve child down, AWAITED so the child can never outlive the
 * case: SIGTERM (the clean path, which also removes `serve.json`), a
 * bounded wait, then SIGKILL if it lingers.
 */
async function stopServeChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForChildExit(child, SERVE_SHUTDOWN_GRACE_MS)) return;
  child.kill('SIGKILL');
  await waitForChildExit(child, SERVE_SHUTDOWN_GRACE_MS);
}

/** Resolve `true` when the child exits within `timeoutMs`, `false` otherwise. */
function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once('exit', onExit);
  });
}

/**
 * Evaluate a step's `capture` map against its stdout.
 *
 * Every failure is fatal to the case rather than silently skipped: a
 * capture that matched nothing would leave its placeholder unbound, and
 * the downstream invocation would fail for a reason that has nothing to
 * do with what the case is testing.
 */
function applyCaptures(
  capture: Record<string, string>,
  stdout: string,
  stepArgv: string[],
): { ok: true; values: TCaptures } | { ok: false; reason: string } {
  const argv = stepArgv.join(' ');
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch (err) {
    return {
      ok: false,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.captureStdoutNotJson, {
        argv,
        message: formatErrorMessage(err),
      }),
    };
  }
  const values: TCaptures = {};
  for (const [name, path] of Object.entries(capture)) {
    const resolved = resolveCapture(doc, name, path, argv);
    if (!resolved.ok) return resolved;
    values[name] = resolved.value;
  }
  return { ok: true, values };
}

/** Resolve one `capture` entry to the scalar string spliced into argv. */
function resolveCapture(
  doc: unknown,
  name: string,
  path: string,
  argv: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const segments = parsePath(path);
  if (!segments) {
    return { ok: false, reason: tx(CONFORMANCE_RUNNER_TEXTS.unsupportedJsonPath, { path }) };
  }
  const walked = traverseJsonPath(doc, segments, path);
  if (!walked.ok || walked.value === undefined) {
    return { ok: false, reason: tx(CONFORMANCE_RUNNER_TEXTS.captureNoMatch, { argv, name, path }) };
  }
  // Only scalars: the captured value is spliced into argv, and an object
  // or array there would stringify into something no CLI can consume,
  // failing far from the mistake.
  if (typeof walked.value !== 'string' && typeof walked.value !== 'number') {
    return {
      ok: false,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.captureNotScalar, {
        argv,
        name,
        path,
        type: walked.value === null ? 'null' : typeof walked.value,
      }),
    };
  }
  return { ok: true, value: String(walked.value) };
}

/**
 * Replace every top-level entry in `scope` EXCEPT `.skill-map/` (which
 * holds the kernel DB and persists across staging steps), then copy
 * the fixture's contents on top. Used by `priorScans` and the main
 * fixture phase to swap Provider content while keeping the DB stable.
 *
 * `fixturesRoot` is the absolute path to the `fixtures/` directory of
 * the conformance suite hosting the case (spec-owned for kernel cases,
 * Provider-owned for Provider cases, see `IRunCaseOptions.fixturesRoot`).
 */
function replaceFixture(scope: string, fixturesRoot: string, fixture: string): void {
  assertContained(fixturesRoot, fixture, 'fixture');
  for (const entry of readdirSync(scope)) {
    if (entry === KERNEL_SKILL_MAP_DIR) continue;
    rmSync(join(scope, entry), { recursive: true, force: true });
  }
  const src = join(fixturesRoot, fixture);
  cpSync(src, scope, { recursive: true });
}

/**
 * Grant local import-trust to every drop-in plugin in the provisioned
 * scope, writing the scope-lock records directly through the same
 * production helper `sm plugins trust` uses.
 *
 * Writing records rather than invoking the verb is deliberate: the id IS
 * the directory name, so this works WITHOUT importing the plugin, which
 * matters for the intentionally-broken fixtures a real `sm plugins trust`
 * could not enumerate (`plugin-missing-ui-rejected`, whose plugin must be
 * imported to be rejected for its missing UI).
 *
 * This used to hand-write a `config_plugins` row, which meant bootstrapping
 * the DB schema first via `sm init --no-scan` (or a throwaway `scan`) just
 * to have a table to insert into. The lock needs none of that: it is a file
 * beside the plugins, so the whole dance is gone. No-op when the fixture
 * ships no plugins.
 */
function grantFixturePluginTrust(scope: string): void {
  const pluginsDir = join(scope, KERNEL_SKILL_MAP_DIR, 'plugins');
  if (!existsSync(pluginsDir)) return;
  const ids = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(pluginsDir, e.name, 'plugin.json')))
    .map((e) => e.name);
  for (const id of ids) grantTrust(scope, id);
}

/**
 * Reject case-supplied path strings that escape the directory tree they
 * are anchored to. A hostile case JSON would otherwise be able to copy
 * arbitrary filesystem content into the tmp scope (`fixture: "../.."`)
 * or read files outside the conformance sandbox via `file-exists` /
 * `file-contains-verbatim` assertions.
 */
/**
 * Normalise a case's `schema` reference to a spec-root-relative path.
 *
 * Cases may write it with or without the `schemas/` prefix, and the
 * containment guard has to see the SAME string the reader will resolve,
 * or the check and the read disagree about what was validated.
 */
function schemaRelOf(schema: string): string {
  return schema.startsWith('schemas/') ? schema : `schemas/${schema}`;
}

/**
 * Render a JSON value for a failure message, never returning
 * `undefined`.
 *
 * `JSON.stringify(undefined)` is `undefined` rather than a string, and
 * the interpolator rejects that, so a `json-path` whose expression
 * matched nothing threw instead of failing. Naming the absence is what
 * the case author needs: "the key is missing" and "the key holds
 * something else" are different bugs.
 */
function describeJsonValue(value: unknown): string {
  return value === undefined ? '(no match)' : JSON.stringify(value);
}

function assertContained(root: string, rel: string, label: string): void {
  if (isAbsolute(rel)) {
    throw new Error(
      tx(CONFORMANCE_RUNNER_TEXTS.pathMustBeRelative, { label, path: rel, anchor: root }),
    );
  }
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || isAbsolute(r)) {
    throw new Error(
      tx(CONFORMANCE_RUNNER_TEXTS.pathEscapesAnchor, { label, path: rel, anchor: root }),
    );
  }
}

interface TAssertionContext {
  exitCode: number;
  stdout: string;
  stderr: string;
  scope: string;
  specRoot: string;
  fixturesRoot: string;
  /** Resolved `setup.serve` port; undefined when the case declared no server. */
  servePort: number | undefined;
}

// Switch over assertion types (`exit-code` / `json-path` /
// `file-exists` / `file-contains-verbatim` / `stdout-contains-verbatim` /
// `file-matches-schema` / `stdout-matches-schema` / `http-matches-schema` /
// `ndjson-line` / `stderr-matches`) with one branch per type. Splitting
// per type would scatter the discriminated-union dispatch. Async because
// `http-matches-schema` awaits a fetch; every other branch stays sync.
// eslint-disable-next-line complexity
async function evaluateAssertion(a: TAssertion, ctx: TAssertionContext): Promise<TAssertionResult> {
  switch (a.type) {
    case 'exit-code':
      return ctx.exitCode === a.value
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.expectedExitCode, {
              expected: a.value,
              actual: ctx.exitCode,
            }),
          };
    case 'json-path':
      return evaluateJsonPath(a, ctx);
    case 'file-exists': {
      try {
        assertContained(ctx.scope, a.path, 'file-exists');
      } catch (err) {
        return { ok: false, type: a.type, reason: formatErrorMessage(err) };
      }
      const abs = resolve(ctx.scope, a.path);
      return existsSync(abs)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.fileNotFound, { path: a.path }),
          };
    }
    case 'file-contains-verbatim': {
      try {
        assertContained(ctx.fixturesRoot, a.fixture, 'file-contains-verbatim/fixture');
        assertContained(ctx.scope, a.path, 'file-contains-verbatim/path');
      } catch (err) {
        return { ok: false, type: a.type, reason: formatErrorMessage(err) };
      }
      const fixturePath = join(ctx.fixturesRoot, a.fixture);
      const targetPath = resolve(ctx.scope, a.path);
      if (!existsSync(targetPath)) {
        return {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.targetNotFound, { path: a.path }),
        };
      }
      const needle = readFileSync(fixturePath);
      const haystack = readFileSync(targetPath);
      return haystack.includes(needle)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.targetMissingFixture, { fixture: a.fixture }),
          };
    }
    case 'stdout-contains-verbatim': {
      try {
        assertContained(ctx.fixturesRoot, a.fixture, 'stdout-contains-verbatim/fixture');
      } catch (err) {
        return { ok: false, type: a.type, reason: formatErrorMessage(err) };
      }
      const needle = readFileSync(join(ctx.fixturesRoot, a.fixture));
      const haystack = Buffer.from(ctx.stdout, 'utf8');
      return haystack.includes(needle)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.stdoutMissingFixture, { fixture: a.fixture }),
          };
    }
    case 'file-matches-schema': {
      // Same containment guard every other file-touching assertion runs
      // (audit follow-up 6.4). A case is data, and a conformance suite
      // is expected to run cases it did not author, so `path` is exactly
      // as untrusted here as a link target is during a scan.
      try {
        assertContained(ctx.scope, a.path, 'file-matches-schema/path');
        assertContained(ctx.specRoot, schemaRelOf(a.schema), 'file-matches-schema/schema');
      } catch (err) {
        return { ok: false, type: a.type, reason: formatErrorMessage(err) };
      }
      const target = resolve(ctx.scope, a.path);
      if (!existsSync(target)) {
        return {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.targetNotFound, { path: a.path }),
        };
      }
      const parsed = parseJsonForSchema(readFileSync(target, 'utf8'), a.path);
      if (!parsed.ok) return { ok: false, type: a.type, reason: parsed.reason };
      const verdict = checkAgainstSchema(parsed.value, a.schema, ctx.specRoot, {
        schemaPointer: a.schemaPointer,
        each: a.each,
      });
      return verdict.ok
        ? { ok: true, type: a.type }
        : { ok: false, type: a.type, reason: verdict.reason };
    }
    case 'stdout-matches-schema': {
      try {
        assertContained(ctx.specRoot, schemaRelOf(a.schema), 'stdout-matches-schema/schema');
      } catch (err) {
        return { ok: false, type: a.type, reason: formatErrorMessage(err) };
      }
      const parsed = parseJsonForSchema(ctx.stdout, 'stdout');
      if (!parsed.ok) return { ok: false, type: a.type, reason: parsed.reason };
      const verdict = checkAgainstSchema(parsed.value, a.schema, ctx.specRoot, {
        schemaPointer: a.schemaPointer,
        each: a.each,
      });
      return verdict.ok
        ? { ok: true, type: a.type }
        : { ok: false, type: a.type, reason: verdict.reason };
    }
    case 'http-matches-schema':
      return evaluateHttpMatchesSchema(a, ctx);
    case 'ndjson-line':
      return evaluateNdjsonLine(a, ctx);
    case 'stderr-matches': {
      const re = new RegExp(a.pattern);
      return re.test(ctx.stderr)
        ? { ok: true, type: a.type }
        : {
            ok: false,
            type: a.type,
            reason: tx(CONFORMANCE_RUNNER_TEXTS.stderrDidNotMatch, { pattern: a.pattern }),
          };
    }
  }
}

/** Abort window for a `http-matches-schema` request against the local server. */
const HTTP_ASSERTION_TIMEOUT_MS = 10_000;

/**
 * `http-matches-schema`: issue the declared request against the server
 * `setup.serve` started (loopback, port resolved from `serve.json`),
 * compare the status, then parse + validate the body like the other two
 * schema assertions.
 *
 * Declaring it in a case WITHOUT `setup.serve: true` is an authoring
 * error reported as a loud failure BEFORE any fetch is attempted:
 * skipping it would report a green case that never checked anything,
 * which is the exact failure mode the schema assertions exist to kill.
 */
async function evaluateHttpMatchesSchema(
  a: Extract<TAssertion, { type: 'http-matches-schema' }>,
  ctx: TAssertionContext,
): Promise<TAssertionResult> {
  const method = a.request.method ?? 'GET';
  if (ctx.servePort === undefined) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.httpWithoutServe, { method, path: a.request.path }),
    };
  }
  try {
    assertContained(ctx.specRoot, schemaRelOf(a.schema), 'http-matches-schema/schema');
  } catch (err) {
    return { ok: false, type: a.type, reason: formatErrorMessage(err) };
  }
  const response = await performHttpAssertionRequest(method, a.request.path, ctx.servePort);
  if (!response.ok) return { ok: false, type: a.type, reason: response.reason };
  return checkHttpResponseAgainstSchema(a, method, response, ctx.specRoot);
}

/**
 * The verdict half of `evaluateHttpMatchesSchema`: status compare first
 * (a mismatch fails naming both codes, before the body is judged), then
 * the same parse + validate pipeline the other two schema assertions run.
 */
function checkHttpResponseAgainstSchema(
  a: Extract<TAssertion, { type: 'http-matches-schema' }>,
  method: string,
  response: { status: number; body: string },
  specRoot: string,
): TAssertionResult {
  const expected = a.status ?? 200;
  if (response.status !== expected) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.httpStatusMismatch, {
        method,
        path: a.request.path,
        actual: response.status,
        expected,
      }),
    };
  }
  const parsed = parseJsonForSchema(response.body, `${method} ${a.request.path}`);
  if (!parsed.ok) return { ok: false, type: a.type, reason: parsed.reason };
  const verdict = checkAgainstSchema(parsed.value, a.schema, specRoot, {
    schemaPointer: a.schemaPointer,
    each: a.each,
  });
  return verdict.ok
    ? { ok: true, type: a.type }
    : { ok: false, type: a.type, reason: verdict.reason };
}

/**
 * The fetch leg of `evaluateHttpMatchesSchema`, folded into a
 * discriminated union so the caller reports a refused / hung / crashed
 * server as an assertion failure rather than unwinding the runner.
 */
async function performHttpAssertionRequest(
  method: string,
  path: string,
  port: number,
): Promise<{ ok: true; status: number; body: string } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      signal: AbortSignal.timeout(HTTP_ASSERTION_TIMEOUT_MS),
    });
    return { ok: true, status: response.status, body: await response.text() };
  } catch (err) {
    return {
      ok: false,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.httpRequestFailed, {
        method,
        path,
        message: formatErrorMessage(err),
      }),
    };
  }
}

/**
 * `ndjson-line`: parse stdout line-wise (every non-empty line MUST be
 * JSON, since surfaces contracted as ndjson emit nothing else on
 * stdout), select the FIRST line whose document deep-equals every
 * top-level key/value in `match`, then optionally walk `path` and apply
 * the shared JSONPath comparators against that line's document.
 */
function evaluateNdjsonLine(
  a: Extract<TAssertion, { type: 'ndjson-line' }>,
  ctx: TAssertionContext,
): TAssertionResult {
  const parsed = parseNdjsonStdout(ctx.stdout);
  if (!parsed.ok) return { ok: false, type: a.type, reason: parsed.reason };
  const matched = parsed.docs.find((doc) => matchesTopLevelKeys(doc, a.match));
  if (matched === undefined) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.ndjsonNoLineMatched, {
        match: JSON.stringify(a.match),
      }),
    };
  }
  if (a.path === undefined) return { ok: true, type: a.type };
  const segments = parsePath(a.path);
  if (!segments) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.unsupportedJsonPath, { path: a.path }),
    };
  }
  const walked = traverseJsonPath(matched, segments, a.path);
  if (!walked.ok) return { ok: false, type: a.type, reason: walked.reason };
  return applyJsonPathComparator({ ...a, path: a.path }, walked.value);
}

/**
 * Parse stdout as NDJSON. Whitespace-only lines are dropped; the first
 * non-JSON line fails the whole parse naming its 1-based stdout line
 * number, which points at the stray print the author needs to find.
 */
function parseNdjsonStdout(
  stdout: string,
): { ok: true; docs: unknown[] } | { ok: false; reason: string } {
  const docs: unknown[] = [];
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    try {
      docs.push(JSON.parse(line) as unknown);
    } catch (err) {
      return {
        ok: false,
        reason: tx(CONFORMANCE_RUNNER_TEXTS.ndjsonLineNotJson, {
          line: index + 1,
          message: formatErrorMessage(err),
        }),
      };
    }
  }
  return { ok: true, docs };
}

/** True when `doc` is an object whose value at every `match` key deep-equals the declared literal. */
function matchesTopLevelKeys(doc: unknown, match: Record<string, unknown>): boolean {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return false;
  return Object.entries(match).every(([key, value]) =>
    deepEqual((doc as Record<string, unknown>)[key], value),
  );
}

/**
 * Minimal JSONPath evaluator, supports only the subset used by the stub
 * conformance suite: `$.foo`, `$.foo.bar`, `$.foo.length`, `$[0]`.
 * The full RFC 9535 implementation lands with Step 2.
 */
function evaluateJsonPath(
  a: Extract<TAssertion, { type: 'json-path' }>,
  ctx: TAssertionContext,
): TAssertionResult {
  let doc: unknown;
  try {
    doc = JSON.parse(ctx.stdout);
  } catch (err) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.stdoutNotJson, { message: formatErrorMessage(err) }),
    };
  }

  const segments = parsePath(a.path);
  if (!segments) {
    return {
      ok: false,
      type: a.type,
      reason: tx(CONFORMANCE_RUNNER_TEXTS.unsupportedJsonPath, { path: a.path }),
    };
  }

  const walked = traverseJsonPath(doc, segments, a.path);
  if (!walked.ok) return { ok: false, type: a.type, reason: walked.reason };

  return applyJsonPathComparator(a, walked.value);
}

/**
 * Walk a parsed JSONPath segment list against a JSON document. Returns
 * the resolved value or a structured failure (caller maps to
 * `TAssertionResult`). Pure, no IO, no shared state.
 */
function traverseJsonPath(
  doc: unknown,
  segments: Array<string | number>,
  path: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  let current: unknown = doc;
  for (const seg of segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) {
        return { ok: false, reason: tx(CONFORMANCE_RUNNER_TEXTS.expectedArrayAtPath, { path }) };
      }
      current = current[seg];
    } else if (seg === 'length' && Array.isArray(current)) {
      current = current.length;
    } else if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return {
        ok: false,
        reason: tx(CONFORMANCE_RUNNER_TEXTS.cannotTraverseSegment, {
          type: typeof current,
          segment: String(seg),
        }),
      };
    }
  }
  return { ok: true, value: current };
}

/**
 * The comparator-bearing slice shared by `json-path` and `ndjson-line`:
 * both walk a JSONPath and apply the same four comparators, only against
 * different documents (whole stdout vs one matched ndjson line).
 */
interface IPathComparatorAssertion {
  type: string;
  path: string;
  equals?: unknown;
  greaterThan?: number;
  lessThan?: number;
  matches?: string;
}

/**
 * Apply the comparator clause (`equals` / `greaterThan` / `lessThan` /
 * `matches`) of a path assertion against the value resolved at the
 * requested path. Returns the final `TAssertionResult` directly.
 *
 * Complexity from the four parallel comparator branches; splitting into
 * one helper per comparator would be ceremony.
 */
// eslint-disable-next-line complexity
function applyJsonPathComparator(
  a: IPathComparatorAssertion,
  current: unknown,
): TAssertionResult {
  if ('equals' in a && a.equals !== undefined) {
    return deepEqual(current, a.equals)
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathEqualsMismatch, {
            path: a.path,
            // `JSON.stringify(undefined)` returns undefined, NOT a
            // string, so a path that matched nothing used to blow up in
            // `tx` with "variable actual is null/undefined" instead of
            // reporting the mismatch. A case probing a key an
            // implementation does not emit is the single most likely way
            // to hit this, which is exactly when the author needs a
            // readable failure rather than a stack trace.
            actual: describeJsonValue(current),
            expected: describeJsonValue(a.equals),
          }),
        };
  }
  if ('greaterThan' in a && typeof a.greaterThan === 'number') {
    return typeof current === 'number' && current > a.greaterThan
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathNotGreaterThan, {
            path: a.path,
            value: a.greaterThan,
          }),
        };
  }
  if ('lessThan' in a && typeof a.lessThan === 'number') {
    return typeof current === 'number' && current < a.lessThan
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathNotLessThan, {
            path: a.path,
            value: a.lessThan,
          }),
        };
  }
  if ('matches' in a && typeof a.matches === 'string') {
    const re = new RegExp(a.matches);
    return typeof current === 'string' && re.test(current)
      ? { ok: true, type: a.type }
      : {
          ok: false,
          type: a.type,
          reason: tx(CONFORMANCE_RUNNER_TEXTS.jsonPathDidNotMatch, {
            path: a.path,
            pattern: a.matches,
          }),
        };
  }
  return { ok: false, type: a.type, reason: CONFORMANCE_RUNNER_TEXTS.jsonPathNoComparator };
}

function parsePath(path: string): Array<string | number> | null {
  if (!path.startsWith('$')) return null;
  const tail = path.slice(1);
  const segments: Array<string | number> = [];
  const re = /\.([a-zA-Z_][a-zA-Z0-9_-]*)|\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tail)) !== null) {
    if (match.index !== lastIndex) return null;
    if (match[1] !== undefined) segments.push(match[1]);
    else if (match[2] !== undefined) segments.push(Number.parseInt(match[2], 10));
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== tail.length) return null;
  return segments;
}

// Structural equality over arbitrary JSON values: primitive / null /
// array / object branches plus per-branch length / key-set checks.
// The branching IS the type table. Per `context/lint.md` category 7
// (recursive type-discriminator walkers).
// eslint-disable-next-line complexity
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        {return false;}
    }
    return true;
  }
  return false;
}

/** Verifies the spec root looks sane (contains `index.json`). */
export function assertSpecRoot(specRoot: string): void {
  const indexPath = join(specRoot, 'index.json');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(tx(CONFORMANCE_RUNNER_TEXTS.specRootMissingIndex, { specRoot }));
  }
}
