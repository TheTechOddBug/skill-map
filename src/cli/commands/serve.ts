/**
 * `sm serve`, start the Hono BFF (single-port: `/api/*` + `/ws` + SPA bundle).
 *
 * Step 14.1 surface: `/api/health` is the only real endpoint. Every
 * other `/api/*` returns the structured error envelope (404 `not-found`).
 * `/ws` accepts a WebSocket upgrade and immediately closes (broadcaster
 * lands at 14.4). The Angular SPA is served from `--ui-dist <path>` (or
 * the auto-resolved `ui/dist/browser/` walking upwards from cwd); the
 * SPA fallback hands `index.html` to any unmatched GET.
 *
 * Defaults, locked at the Step 14 pivot:
 *
 *   - `--port`  = `4242`
 *   - `--host`  = `127.0.0.1` (loopback-only through v0.6.0; Decision #119)
 *   - `--open`  = on (browser opens after listen; `--no-open` opts out)
 *
 * Scope is always project-local: the BFF serves `<cwd>/.skill-map/`.
 * Per `spec/cli-contract.md` §Scope is always project-local, there is
 * no `--scope` flag.
 *
 * Exit codes:
 *
 *   - `ExitCode.Ok` (0)        → clean shutdown via SIGINT / SIGTERM.
 *   - `ExitCode.Error` (2)     → bad flag combo, bind failure, missing UI
 *                                bundle when `--ui-dist <path>` was explicit,
 *                                runtime errors during boot.
 *   - `ExitCode.NotFound` (5)  → `--db <path>` doesn't exist on disk.
 *
 * The verb opts out of `done in <…>` (`emitElapsed = false`), long-running
 * processes never trail the elapsed line; `sm watch` does the same.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { Command, Option } from 'clipanion';

import { isDevBuild } from '../../kernel/util/dev-mode.js';
import { tx } from '../../kernel/util/tx.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { maybeResetOnDrift } from '../../core/sqlite/db-drift-reset.js';
import { DB_DRIFT_TEXTS } from '../../core/sqlite/i18n/db-drift.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { validateBrowserUrl } from '../util/browser-launch.js';
import {
  createServer,
  resolveDefaultUiDist,
  resolveExplicitUiDist,
  validateServerOptions,
  isUiBundleDir,
  type IServerOptionsInput,
  type IServerHandle,
} from '../../server/index.js';
import { initSentryBff } from '../../server/telemetry/sentry.js';
import { SERVE_TEXTS } from '../i18n/serve.texts.js';
import { defaultServeInfoPath, resolveDbPath } from '../util/db-path.js';
import { buildServeInfo, removeServeInfo, writeServeInfo } from '../util/serve-info.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { loadConfig, type IEffectiveConfig } from '../../kernel/config/loader.js';
import { tryParseNonNegativeInt, tryParsePositiveInt } from '../util/option-validators.js';
import { defaultRuntimeContext, type IRuntimeContext } from '../../core/runtime/runtime-context.js';
import { renderBanner, resolveColorEnabled } from '../util/serve-banner.js';
import { resolveWatcherBackend } from '../../core/watcher/runtime.js';
import { SmCommand } from '../util/sm-command.js';
import { VERSION } from '../../version.js';

export class ServeCommand extends SmCommand {
  static override paths = [['serve']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];

  static override usage = Command.Usage({
    category: 'Setup',
    description: 'Start the Hono BFF (single-port: REST + WebSocket + SPA bundle).',
    details: `
      Boots the skill-map Web UI's backing server. One Node process
      serves the Angular SPA, the REST API under /api/*, and the
      WebSocket at /ws (single-port mandate, no proxy).

      Default port is 4242, default host is 127.0.0.1. The server boots
      even when the project DB is missing; /api/health reports
      'db: missing' so the SPA renders an empty-state CTA instead of
      failing the connection.

      Loopback-only assumption through v0.6.0 (no per-connection auth on
      /ws). Combining --dev-cors with a non-loopback --host is rejected.

      SIGINT / SIGTERM trigger a graceful shutdown.
    `,
    examples: [
      ['Start on the default port and open the browser', '$0 serve'],
      ['Custom port, no browser auto-open', '$0 serve --port 5000 --no-open'],
      ['Point at a pre-built UI bundle', '$0 serve --ui-dist ./ui/dist/browser'],
    ],
  });

  port = Option.String('--port', {
    required: false,
    description: 'Listening port (default 4242). 0 = OS-assigned.',
  });
  host = Option.String('--host', {
    required: false,
    description: 'Listening host (default 127.0.0.1). Loopback-only enforced when --dev-cors is set.',
  });
  noBuiltIns = Option.Boolean('--no-built-ins', false, {
    description: 'Skip built-in plugin registration (parity with sm scan --no-built-ins).',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery.',
  });
  // `Option.Boolean('--open', true)`, Clipanion's parser auto-derives
  // the `--no-open` inverse for every boolean flag (search for
  // `--no-${name.slice(2)}` in clipanion's core), so the explicit
  // `--no-open` descriptor must NOT be declared here or the parser sees
  // two registrations for the same flag and rejects the invocation
  // with "Ambiguous Syntax Error". Same convention shipped by every
  // other `--no-...` flag in the CLI tree.
  open = Option.Boolean('--open', true, {
    description: 'Auto-open the SPA in the user\'s default browser after listen. --no-open opts out.',
  });
  devCors = Option.Boolean('--dev-cors', false, {
    description: 'Enable permissive CORS for the Angular dev-server proxy workflow.',
  });
  // `--ui-dist` is intentionally undocumented in the Usage block above
  // (the demo build pipeline + tests rely on it; everyday users never
  // need it). Clipanion still exposes it on the parser; the Usage
  // omission is the "hidden" contract per the 14.1 brief.
  uiDist = Option.String('--ui-dist', { required: false, hidden: true });
  noUi = Option.Boolean('--no-ui', false, {
    description: "Don't serve the Angular UI bundle. Use this when running the BFF alongside `ui:dev` (Angular dev server with HMR). The root `/` then renders an inline placeholder pointing the user at the dev server.",
  });
  noWatcher = Option.Boolean('--no-watcher', false, {
    description: 'Disable the chokidar-fed scan-and-broadcast loop. Use only for CI / read-only deployments.',
  });
  // No default: `undefined` when neither `--mcp` nor `--no-mcp` was
  // passed, so the verb can apply the precedence flag > `mcp.server.enabled`
  // config > default off. Clipanion auto-derives `--no-mcp` as the
  // negation (same convention as `--no-open`), so declaring only `--mcp`
  // registers both.
  mcp = Option.Boolean('--mcp', {
    description:
      'Mount the MCP server at /mcp (Model Context Protocol): query the map plus drive the job queue and findings. Overrides mcp.server.enabled; --no-mcp forces it off. Off by default.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Skip the interactive prompt and rebuild the local cache when the on-disk DB has drifted (version skew or an inline schema change). Non-TTY invocations rebuild without asking regardless of this flag.',
  });
  // `--watcher-debounce-ms` is undocumented sugar for advanced users
  // who want to tighten / relax the watcher's batching window without
  // editing settings.json. Hidden flag, the Usage block omits it.
  watcherDebounceMs = Option.String('--watcher-debounce-ms', { required: false, hidden: true });
  maxScan = Option.String('--max-scan', {
    required: false,
    description: 'Per-invocation override of scan.maxScan (default 5000), the WALK-INTAKE ceiling. The scan walks, parses, analyzes, and reference-validates the full corpus up to this number. Bidirectional: raises OR lowers the ceiling. Applies to every scan the server runs (initial watcher pass, debounced batches, POST /api/scan, GET /api/scan?fresh=1). Same flag is honoured on the bare `sm` invocation, which routes to `sm serve`.',
  });
  maxNodes = Option.String('--max-nodes', {
    required: false,
    description: 'Per-invocation override of scan.maxNodes (default 256), the MAP RENDER cap (pure metadata): it does NOT bound the scan, only how many nodes the graph view projects onto the canvas. Bidirectional: raises OR lowers the render cap. Same flag is honoured on the bare `sm` invocation, which routes to `sm serve`.',
  });
  watchBackend = Option.String('--watch-backend', {
    required: false,
    description: 'Per-invocation override of scan.watch.backend, the primary watcher backend. chokidar (the default) observes changes behind a symlinked directory live; parcel is a single native inotify instance that scales to huge trees without chokidar\'s EMFILE exhaustion. Accepted values: chokidar, parcel. Same flag is honoured on the bare `sm` invocation, which routes to `sm serve`.',
  });

  // Long-running daemon, `done in <…>` after a graceful shutdown is
  // noise. Mirrors `sm watch`'s opt-out.
  protected override emitElapsed = false;

  // CLI orchestrator with multi-flag handling, each `if (this.flag)`
  // branch is one cyclomatic point. Splitting per branch scatters the
  // validation away from the flag it gates. Per context/lint.md
  // category 1 ("CLI orchestrators with multi-flag handling").
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const runtimeCtx = defaultRuntimeContext();
    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');
    const warnGlyph = stderrAnsi.yellow('⚠');
    const infoGlyph = stderrAnsi.cyan('ℹ');

    // 1. Parse --port up front so a non-numeric value rejects with a
    //    clear hint (Clipanion gives us the raw string).
    const portResult = parsePort(this.port);
    if (!portResult.ok) {
      this.printer!.error(
        tx(SERVE_TEXTS.portInvalid, {
          glyph: errGlyph,
          value: sanitizeForTerminal(portResult.value),
          hint: stderrAnsi.dim(SERVE_TEXTS.portInvalidHint),
        }),
      );
      return ExitCode.Error;
    }

    // 2. DB path (--db wins over project default).
    const dbPath = resolveDbPath({ db: this.db, ...runtimeCtx });
    // Only `--db <path>` triggers the NotFound exit; the project
    // default may legitimately be absent (boot-with-missing-DB is the
    // documented behaviour per Decision §14.1).
    if (this.db !== undefined && !existsSync(dbPath)) {
      this.printer!.error(
        tx(SERVE_TEXTS.dbNotFound, {
          glyph: errGlyph,
          path: sanitizeForTerminal(dbPath),
          hint: stderrAnsi.dim(SERVE_TEXTS.dbNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    // 3. UI bundle resolution.
    //    - `--no-ui` + `--ui-dist <path>` is contradictory → exit 2.
    //    - `--no-ui` alone → skip resolution, force uiDist=null, route
    //      the static middleware at the dev-mode placeholder.
    //    - Explicit path → exit 2 if missing; auto-resolved → null
    //      (server logs the placeholder hint).
    if (this.noUi && this.uiDist !== undefined) {
      this.printer!.error(
        tx(SERVE_TEXTS.noUiConflictsUiDist, {
          glyph: errGlyph,
          path: sanitizeForTerminal(this.uiDist),
          hint: stderrAnsi.dim(SERVE_TEXTS.noUiConflictsUiDistHint),
        }),
      );
      return ExitCode.Error;
    }
    let resolvedUiDist: string | null;
    if (this.noUi) {
      resolvedUiDist = null;
    } else {
      const uiDistResult = resolveUiDist(runtimeCtx, this.uiDist);
      if (!uiDistResult.ok) {
        this.printer!.error(
          tx(SERVE_TEXTS.startupFailed, {
            glyph: errGlyph,
            message: sanitizeForTerminal(uiDistResult.message),
          }),
        );
        return ExitCode.Error;
      }
      resolvedUiDist = uiDistResult.uiDist;
    }

    // 3a. Non-fatal info: pairing `--no-ui` with `--open` opens the
    //     placeholder rather than the live SPA. The Architect almost
    //     certainly meant `--no-open` if they're running `ui:dev` in
    //     another terminal, call it out, but don't reject.
    if (this.noUi && this.open) {
      this.printer!.info(
        tx(SERVE_TEXTS.noUiOpenWarning, { glyph: warnGlyph }),
      );
    }

    // 3b. Parse --watcher-debounce-ms up front. Empty / non-integer →
    //     reject with the same template family the other numeric
    //     parsers use.
    const debounceResult = parseDebounce(this.watcherDebounceMs);
    if (!debounceResult.ok) {
      this.printer!.error(
        tx(SERVE_TEXTS.watcherDebounceInvalid, {
          glyph: errGlyph,
          value: sanitizeForTerminal(debounceResult.value),
          hint: stderrAnsi.dim(SERVE_TEXTS.watcherDebounceInvalidHint),
        }),
      );
      return ExitCode.Error;
    }

    // 3c. Parse --max-scan (walk ceiling) and --max-nodes (render cap).
    //     Same shape as the watcher-debounce parser: omit → undefined
    //     (the runtime falls back to scan.maxScan / scan.maxNodes),
    //     positive integer → honoured for every scan the server runs.
    const maxScanResult = parseMaxIntFlag(this.maxScan);
    if (!maxScanResult.ok) {
      this.printer!.error(
        tx(SERVE_TEXTS.maxScanInvalid, {
          glyph: errGlyph,
          value: sanitizeForTerminal(maxScanResult.value),
          hint: stderrAnsi.dim(SERVE_TEXTS.maxScanInvalidHint),
        }),
      );
      return ExitCode.Error;
    }
    const maxNodesResult = parseMaxIntFlag(this.maxNodes);
    if (!maxNodesResult.ok) {
      this.printer!.error(
        tx(SERVE_TEXTS.maxNodesInvalid, {
          glyph: errGlyph,
          value: sanitizeForTerminal(maxNodesResult.value),
          hint: stderrAnsi.dim(SERVE_TEXTS.maxNodesInvalidHint),
        }),
      );
      return ExitCode.Error;
    }

    // 3d. Parse --watch-backend (primary watcher backend). Omit →
    //     undefined (the runtime falls back to scan.watch.backend);
    //     'chokidar' / 'parcel' → honoured for every watcher session the
    //     server runs. Any other value rejects with exit 2.
    const watchBackendResult = parseWatchBackendFlag(this.watchBackend);
    if (!watchBackendResult.ok) {
      this.printer!.error(
        tx(SERVE_TEXTS.watchBackendInvalid, {
          glyph: errGlyph,
          value: sanitizeForTerminal(watchBackendResult.value),
          hint: stderrAnsi.dim(SERVE_TEXTS.watchBackendInvalidHint),
        }),
      );
      return ExitCode.Error;
    }

    // 3e. Config-layer peek, loaded ONCE and reused by the bind
    //     resolution here and the banner below. Best-effort: a
    //     malformed config falls back to built-in defaults (the same
    //     posture the banner always had); `sm config show` is the
    //     surface that reports the breakage.
    let projectCfg: IEffectiveConfig | null = null;
    try {
      projectCfg = loadConfig({ cwd: runtimeCtx.cwd }).effective;
    } catch {
      // Defaults apply; never block boot on a decoration/config read.
    }

    // 4. Validate the assembled options bag (loopback + dev-cors check,
    //    port range check). Errors map to the right SERVE_TEXTS template.
    //    Bind precedence: flag (override layer) > `server.port` /
    //    `server.host` config keys > validator defaults (4242 /
    //    127.0.0.1). A config-supplied non-loopback host hits the same
    //    loopback rejection as a flag-supplied one.
    const input: IServerOptionsInput = {
      dbPath,
      uiDist: resolvedUiDist,
      noUi: this.noUi,
      noBuiltIns: this.noBuiltIns,
      noPlugins: this.noPlugins,
      open: this.open,
      devCors: this.devCors,
      noWatcher: this.noWatcher,
      // MCP server precedence: flag (`--mcp` / `--no-mcp`) > the resolved
      // `mcp.server.enabled` config key > default off. `this.mcp` is
      // `undefined` when neither flag was passed. See `spec/mcp-server.md`
      // §Enablement.
      mcpServer: this.mcp ?? projectCfg?.mcp?.server?.enabled ?? false,
    };
    const boundPort = portResult.port ?? projectCfg?.server.port;
    const boundHost = this.host ?? projectCfg?.server.host;
    if (boundPort !== undefined) input.port = boundPort;
    if (boundHost !== undefined) input.host = boundHost;
    if (debounceResult.value !== undefined) input.watcherDebounceMs = debounceResult.value;
    if (maxScanResult.value !== undefined) input.maxScan = maxScanResult.value;
    if (maxNodesResult.value !== undefined) input.maxNodes = maxNodesResult.value;
    if (watchBackendResult.value !== undefined) input.watchBackend = watchBackendResult.value;

    const validation = validateServerOptions(input);
    if (!validation.ok) {
      this.printer!.error(formatValidationError(validation.error, stderrAnsi));
      return ExitCode.Error;
    }

    // 4b. Pre-1.0 schema-drift rebuild. Before the server boots (and its
    //     watcher opens the DB with `assumeYes`), give an interactive
    //     operator the chance to confirm rebuilding a drifted cache
    //     (version skew OR an inline schema change). `--yes` and a
    //     non-TTY stdin auto-confirm; declining aborts boot with a clear
    //     message + nonzero exit so we never start listening against a
    //     cache that the watcher would then silently wipe out from under
    //     the connected SPA. See spec/db-schema.md §Schema drift.
    const driftAbort = await this.#rebuildOnDrift(dbPath, stderrAnsi, warnGlyph);
    if (driftAbort !== null) return driftAbort;

    // 5. Resolve stderr / TTY / color BEFORE boot: the watcher spinner
    //    (wired into `createServer` below) and the boot banner (printed
    //    after listen) both read these. Color honours `--no-color`,
    //    `NO_COLOR`, and `FORCE_COLOR`; the spinner util handles the
    //    non-TTY degrade itself, so we never gate the wiring on `isTTY`.
    const stderr = this.context.stderr as NodeJS.WritableStream & { isTTY?: boolean };
    const isTTY = stderr.isTTY === true;
    const colorEnabled = resolveColorEnabled({
      isTTY,
      noColorFlag: this.noColor,
      env: process.env,
    });

    // 6. Boot. Initialise BFF telemetry here (the CLI verb owns env reads,
    // the server stays env-free) and only here: the `serve` verb is skipped
    // by the CLI-side init in entry.ts so the two Sentry clients never
    // clobber each other. No-op while the DSN placeholder is empty.
    await initSentryBff(VERSION);
    let handle: IServerHandle;
    try {
      handle = await createServer(validation.options, {
        scanProgress: { stream: stderr, colorEnabled },
        // Opt in to the boot liveness ping: the daemon is the surface
        // whose panel asks "is an agent attending the queue?"
        // (`GET /api/agent/presence`), so it is the surface that pays for
        // one hidden probe job to learn the answer without waiting for
        // organic traffic. Best-effort + silent, it can neither delay nor
        // fail this boot.
        bootPing: true,
      });
    } catch (err) {
      const message = formatErrorMessage(err);
      this.printer!.error(
        tx(SERVE_TEXTS.bindFailed, {
          glyph: errGlyph,
          host: sanitizeForTerminal(validation.options.host),
          port: validation.options.port,
          message: sanitizeForTerminal(message),
        }),
      );
      return ExitCode.Error;
    }

    // 6b. Discovery file (`.skill-map/serve.json`, see
    //     `spec/provider-activity.md` §serve.json): publish the RESOLVED
    //     bound address + the per-session ingest token so co-located
    //     local processes (the activity bridge) can find and
    //     authenticate against THIS project's server. Best-effort: a
    //     write failure warns once and the server keeps serving (live
    //     activity is a bonus surface, never a boot blocker). Removed in
    //     the shutdown `finally` below; a hard kill leaves a stale copy
    //     behind and readers fail open by contract.
    const serveInfoPath = defaultServeInfoPath(runtimeCtx.cwd);
    const serveInfoWritten = writeServeInfo(
      serveInfoPath,
      buildServeInfo({
        host: handle.address.host,
        port: handle.address.port,
        pid: process.pid,
        scopeRoot: runtimeCtx.cwd,
        smVersion: VERSION,
        token: handle.activityToken,
      }),
    );
    if (!serveInfoWritten) {
      this.printer!.info(
        tx(SERVE_TEXTS.serveInfoWriteFailed, {
          glyph: warnGlyph,
          path: sanitizeForTerminal(serveInfoPath),
        }),
      );
    }

    try {
      // 7. Boot banner. TTY-aware (color box vs flat legacy lines) so
      //    pipes / redirects keep grep-friendly output. `stderr` / `isTTY`
      //    / `colorEnabled` were resolved before boot (step 5) so the
      //    watcher spinner and this banner share one resolution.
      //    Reads the step-3e config peek (one load per boot); a failed
      //    load already degraded to defaults there.
      const referencePaths: readonly string[] = projectCfg?.scan.referencePaths ?? [];
      const watcherBackend: 'chokidar' | 'parcel' = projectCfg
        ? resolveWatcherBackend(projectCfg.scan.watch.backend, watchBackendResult.value)
        : (watchBackendResult.value ?? 'chokidar');

      this.printer!.info(
        renderBanner({
          version: VERSION,
          host: sanitizeForTerminal(handle.address.host),
          port: handle.address.port,
          dbPath,
          cwd: runtimeCtx.cwd,
          openBrowser: validation.options.open,
          isTTY,
          colorEnabled,
          referencePaths,
          dev: isDevBuild(),
          backend: watcherBackend,
        }),
      );

      // 8. Browser auto-open (best-effort; failure → stderr hint, never a fail).
      if (validation.options.open) {
        const url = `http://${handle.address.host}:${handle.address.port}/`;
        tryOpenBrowser(url, this.context.stderr, warnGlyph);
      }

      // 9. Wait for SIGINT / SIGTERM, then close.
      await waitForShutdown();
      await handle.close();
      this.printer!.info(tx(SERVE_TEXTS.shutdown, { glyph: infoGlyph }));
      return ExitCode.Ok;
    } finally {
      // Discovery-file cleanup, paired with the 6b write. In a `finally`
      // so the banner / open / shutdown path can never leave a live-
      // looking serve.json behind (SIGKILL still can; readers fail open).
      removeServeInfo(serveInfoPath);
    }
  }

  /**
   * Pre-1.0 schema-drift rebuild for `sm serve`, run before boot. Reuses
   * the shared `maybeResetOnDrift` (same prompt / `--yes` / non-TTY
   * policy as `sm scan`), threading the verb's stdin / stderr so a TTY
   * operator is asked y/N. Returns `null` to proceed (no drift, or the
   * cache was rebuilt) or an `ExitCode` to abort boot when the operator
   * declines the rebuild.
   */
  async #rebuildOnDrift(
    dbPath: string,
    stderrAnsi: IAnsi,
    warnGlyph: string,
  ): Promise<number | null> {
    const outcome = await maybeResetOnDrift(dbPath, {
      currentVersion: VERSION,
      assumeYes: this.yes,
      stdin: this.context.stdin,
      stderr: this.context.stderr,
      printer: this.printer!,
      style: { warnGlyph, dim: stderrAnsi.dim },
    });
    if (outcome.kind !== 'aborted') return null;
    this.printer!.error(
      tx(SERVE_TEXTS.driftDeclined, {
        glyph: stderrAnsi.red('✕'),
        dbVersion: outcome.dbVersion,
        currentVersion: outcome.currentVersion,
        reason:
          outcome.reason === 'version'
            ? DB_DRIFT_TEXTS.driftReasonVersion
            : DB_DRIFT_TEXTS.driftReasonSchema,
        hint: stderrAnsi.dim(DB_DRIFT_TEXTS.driftAbortedHint),
      }),
    );
    return ExitCode.Error;
  }
}

interface IPortOk { ok: true; port: number | undefined; }
interface IPortErr { ok: false; value: string; }

function parsePort(raw: string | undefined): IPortOk | IPortErr {
  if (raw === undefined) return { ok: true, port: undefined };
  const parsed = tryParseNonNegativeInt(raw);
  if (parsed === null) return { ok: false, value: raw };
  return { ok: true, port: parsed };
}

interface IDebounceOk { ok: true; value: number | undefined; }
interface IDebounceErr { ok: false; value: string; }

function parseDebounce(raw: string | undefined): IDebounceOk | IDebounceErr {
  if (raw === undefined) return { ok: true, value: undefined };
  const parsed = tryParseNonNegativeInt(raw);
  if (parsed === null) return { ok: false, value: raw };
  return { ok: true, value: parsed };
}

interface IMaxIntOk { ok: true; value: number | undefined; }
interface IMaxIntErr { ok: false; value: string; }

/**
 * Parse a `--max-scan` / `--max-nodes` value (positive integer, or absent
 * → `undefined`). Both flags share the same grammar, so one parser backs
 * both; the verb renders a flag-specific error from the `{ ok: false }`
 * branch later.
 */
function parseMaxIntFlag(raw: string | undefined): IMaxIntOk | IMaxIntErr {
  if (raw === undefined) return { ok: true, value: undefined };
  const n = tryParsePositiveInt(raw);
  if (n === null) return { ok: false, value: raw };
  return { ok: true, value: n };
}

interface IWatchBackendOk { ok: true; value: 'chokidar' | 'parcel' | undefined; }
interface IWatchBackendErr { ok: false; value: string; }

/**
 * Parse a `--watch-backend` value (`chokidar` / `parcel`, or absent →
 * `undefined`). Anything else rejects; the verb renders the §3.1b error
 * block from the `{ ok: false }` branch.
 */
function parseWatchBackendFlag(raw: string | undefined): IWatchBackendOk | IWatchBackendErr {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === 'chokidar' || raw === 'parcel') return { ok: true, value: raw };
  return { ok: false, value: raw };
}

interface IUiDistOk { ok: true; uiDist: string | null; }
interface IUiDistErr { ok: false; message: string; }

function resolveUiDist(ctx: IRuntimeContext, raw: string | undefined): IUiDistOk | IUiDistErr {
  if (raw === undefined) {
    return { ok: true, uiDist: resolveDefaultUiDist(ctx) };
  }
  const abs = resolveExplicitUiDist(ctx, raw);
  if (!isUiBundleDir(abs)) {
    return {
      ok: false,
      message: tx(SERVE_TEXTS.uiDistInvalid, { path: abs }),
    };
  }
  return { ok: true, uiDist: abs };
}

/**
 * Render the validator's discriminated rejection into a §3.1b error
 * block (glyph + headline + dim hint). The single-line wrappers
 * (`bindFailed`, `startupFailed`) keep their §3.1 shape because the
 * inner `{{message}}` varies per call site; the structured rejection
 * codes below all map to a §3.1b template with a sibling hint key.
 */
// Flat per-error-code dispatch: one `case` per `TServerOptionsErrorCode`,
// so cyclomatic complexity grows linearly with the number of validation
// codes (no nesting). Sanctioned "CLI multi-flag handling" shape
// (context/lint.md category 1), same rationale as `validateServerOptions`.
// eslint-disable-next-line complexity
function formatValidationError(
  err: { code: string; value: string; message: string },
  ansi: IAnsi,
): string {
  const errGlyph = ansi.red('✕');
  switch (err.code) {
    case 'host-dev-cors-rejected':
      return tx(SERVE_TEXTS.hostDevCorsRejected, {
        glyph: errGlyph,
        host: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.hostDevCorsRejectedHint),
      });
    case 'host-not-loopback':
      return tx(SERVE_TEXTS.hostNotLoopback, {
        glyph: errGlyph,
        host: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.hostNotLoopbackHint),
      });
    case 'port-out-of-range':
      return tx(SERVE_TEXTS.portOutOfRange, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.portOutOfRangeHint),
      });
    case 'port-invalid':
      return tx(SERVE_TEXTS.portInvalid, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.portInvalidHint),
      });
    case 'watcher-requires-pipeline':
      return tx(SERVE_TEXTS.watcherRequiresPipeline, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.watcherRequiresPipelineHint),
      });
    case 'watcher-debounce-invalid':
      return tx(SERVE_TEXTS.watcherDebounceInvalid, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.watcherDebounceInvalidHint),
      });
    case 'max-scan-invalid':
      return tx(SERVE_TEXTS.maxScanInvalid, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.maxScanInvalidHint),
      });
    case 'max-nodes-invalid':
      return tx(SERVE_TEXTS.maxNodesInvalid, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.maxNodesInvalidHint),
      });
    case 'watch-backend-invalid':
      return tx(SERVE_TEXTS.watchBackendInvalid, {
        glyph: errGlyph,
        value: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.watchBackendInvalidHint),
      });
    case 'no-ui-conflicts-ui-dist':
      return tx(SERVE_TEXTS.noUiConflictsUiDist, {
        glyph: errGlyph,
        path: sanitizeForTerminal(err.value),
        hint: ansi.dim(SERVE_TEXTS.noUiConflictsUiDistHint),
      });
    default:
      return tx(SERVE_TEXTS.startupFailed, {
        glyph: errGlyph,
        message: sanitizeForTerminal(err.message),
      });
  }
}

function waitForShutdown(): Promise<void> {
  return new Promise<void>((resolveShutdown) => {
    const onSignal = (): void => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolveShutdown();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

/**
 * Best-effort browser open. The platform-specific opener is detached
 * + unrefed so an error inside the launcher process can't bubble back
 * up and crash the server. Failures log a hint via stderr but are NEVER
 * fatal, the URL is already printed on the boot banner.
 *
 * The URL is run through `validateBrowserUrl` before the spawn, the
 * Windows path (`cmd /c start "" <url>`) re-parses its argv so any
 * unquoted shell metacharacter (`&`, `|`, `^`, redirection, percent
 * expansion) would let a future caller smuggle commands into the
 * launcher. Today the URL is always a validated loopback, the gate is
 * defensive against future drift, not a current attack.
 */
function tryOpenBrowser(url: string, stderr: NodeJS.WritableStream, warnGlyph: string): void {
  try {
    if (!validateBrowserUrl(url)) {
      stderr.write(
        tx(SERVE_TEXTS.openFailed, {
          glyph: warnGlyph,
          message: sanitizeForTerminal('refused to launch browser: unsafe URL'),
          url: sanitizeForTerminal(url),
        }),
      );
      return;
    }
    const platform = process.platform;
    let command: string;
    let args: string[];
    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      // `start` consumes its first quoted argv slot as the window title,
      // pass an empty string (not the literal `'""'`) so the spawn argv
      // stays unambiguous and `cmd` does not see a stray quote pair.
      command = 'cmd';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      stderr.write(
        tx(SERVE_TEXTS.openFailed, {
          glyph: warnGlyph,
          message: sanitizeForTerminal(formatErrorMessage(err)),
          url: sanitizeForTerminal(url),
        }),
      );
    });
    child.unref();
  } catch (err) {
    stderr.write(
      tx(SERVE_TEXTS.openFailed, {
        glyph: warnGlyph,
        message: sanitizeForTerminal(formatErrorMessage(err)),
        url: sanitizeForTerminal(url),
      }),
    );
  }
}
