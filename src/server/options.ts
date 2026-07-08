/**
 * `IServerOptions`, typed input to `createServer(opts)`.
 *
 * The composition root (`cli/commands/serve.ts`) parses raw flag values,
 * validates them via `validateServerOptions`, and hands the resulting
 * normalized object to `createServer`. The server itself never reads
 * `process.env` / `process.argv`, every knob lives in the options bag.
 *
 * Defaults:
 *
 *   - `port`    , `4242` (Decision: locked at the Step 14 pivot for
 *                  predictable single-port wiring).
 *   - `host`    , `127.0.0.1` (Decision #119: loopback-only through
 *                  v0.6.0; multi-host serve + auth deferred).
 *   - `open`    , `true` (the verb default; tests pass `false`).
 *   - `devCors` , `false`.
 *   - `noBuiltIns` / `noPlugins`, `false`.
 *
 * Scope is always project-local. Per `spec/cli-contract.md` §Scope is
 * always project-local, there is no `scope` option and no `--scope`
 * CLI flag.
 *
 * Validation rules (enforced by `validateServerOptions`):
 *
 *   1. `port` must be an integer in `[0, 65535]`. `0` is allowed (OS
 *      assigns the port; `IServerHandle.address.port` reports the actual
 *      value after bind). `65536+` and negatives reject.
 *   2. When `devCors` is true, `host` MUST be a loopback address
 *      (`127.0.0.1` / `::1` / `localhost`). Non-loopback + `--dev-cors`
 *      is rejected per Decision #119, opening CORS on a non-loopback
 *      socket is the textbook way to hand the SPA's origin to anyone
 *      on the network.
 *
 * The validator returns either `{ ok: true, options }` (with defaults
 * filled in) or `{ ok: false, error: { code, message } }` so the CLI
 * surface can map the error to the right `tx(SERVE_TEXTS.*)` template
 * and exit code (`Error` for bad usage, `NotFound` reserved for the
 * caller's own DB-existence check).
 */

export interface IServerOptions {
  /** Listening port. `0` = OS-assigned. Default `4242`. */
  port: number;

  /** Listening host. Default `127.0.0.1`. Loopback-only enforced when `devCors` is true. */
  host: string;

  /**
   * Pre-resolved DB file path. The CLI computes this via `resolveDbPath`
   * (`--db` > project default) and threads it in. The server NEVER
   * calls `resolveDbPath` itself, kernel-boundary rule: no
   * `process.cwd()` inside the BFF entry beyond the composition root.
   */
  dbPath: string;

  /**
   * Absolute path to the Angular dist bundle (`ui/dist/browser/`).
   * `null` means "auto-detection failed", the server logs a one-liner
   * to stderr via `SERVER_TEXTS.uiBundleMissing` and serves an inline
   * placeholder at `/`. The CLI promotes this to `ExitCode.Error` only
   * when `--ui-dist <path>` was passed explicitly.
   */
  uiDist: string | null;

  /**
   * Intentionally serve the BFF without an Angular bundle. Set by
   * `--no-ui` on the CLI. When `true`, the static middleware renders a
   * dev-mode placeholder pointing the operator at `npm run ui:dev`
   * (Angular dev server with HMR) instead of the
   * "UI bundle was not found" copy that signals an accidental missing
   * bundle. Default `false`. Combining `noUi: true` with a non-null
   * `uiDist` is rejected by `validateServerOptions`.
   */
  noUi: boolean;

  /** Skip built-in plugin registration (parity with `sm scan --no-built-ins`). Default `false`. */
  noBuiltIns: boolean;

  /** Skip drop-in plugin discovery (parity with `sm scan --no-plugins`). Default `false`. */
  noPlugins: boolean;

  /** Auto-open the SPA in the user's default browser after listen. Default `true`. */
  open: boolean;

  /** Enable permissive CORS for the dev workflow (Angular dev server proxy). Default `false`. */
  devCors: boolean;

  /**
   * Disable the chokidar-fed scan-and-broadcast loop. Default `false`
   * (watcher on per Decision #121: a server with stale DB is a footgun).
   * Set to `true` only for CI / read-only deployments where filesystem
   * mutations are not expected; in that mode `/ws` still accepts
   * connections but no `scan.*` events ever fire.
   */
  noWatcher: boolean;

  /**
   * Override for the chokidar debounce window (ms). When `undefined`
   * the watcher reads `scan.watch.debounceMs` from the merged config
   * (default 300ms, see `src/config/defaults.json` and
   * `spec/cli-contract.md` § Watch). Undocumented sugar for advanced
   * users, surface via the hidden `--watcher-debounce-ms` CLI flag.
   */
  watcherDebounceMs?: number | undefined;

  /**
   * Per-invocation override of `scan.maxScan` (default 5000). Mirror
   * of the `--max-scan <N>` flag on `sm serve` (and the bare `sm`
   * invocation, see `cli/entry.ts`). This is the WALK-INTAKE ceiling.
   * When set, every scan the server runs (boot watcher initial pass,
   * debounced batches, `POST /api/scan`, `GET /api/scan?fresh=1`) walks
   * the full corpus up to this number. Bidirectional: any positive
   * integer fully replaces the ceiling for the duration of the server
   * session.
   */
  maxScan?: number | undefined;

  /**
   * Per-invocation override of `scan.maxNodes` (default 256). Mirror
   * of the `--max-nodes <N>` flag on `sm serve` (and the bare `sm`
   * invocation, see `cli/entry.ts`). This is the MAP RENDER cap, pure
   * metadata that does NOT bound the walk. When set, every scan the
   * server runs records this render cap. Bidirectional: any positive
   * integer fully replaces the render cap for the duration of the
   * server session.
   */
  maxNodes?: number | undefined;

  /**
   * Per-invocation override of `scan.watch.backend`, the primary watcher
   * backend. Mirror of the `--watch-backend <chokidar|parcel>` flag on
   * `sm serve` (and the bare `sm` invocation, see `cli/entry.ts`). When
   * set, every watcher session the server runs uses this backend instead
   * of the persisted `scan.watch.backend`. `undefined` falls back to
   * config.
   */
  watchBackend?: 'chokidar' | 'parcel' | undefined;
}

export interface IServerOptionsInput {
  port?: number | undefined;
  host?: string | undefined;
  dbPath: string;
  uiDist?: string | null | undefined;
  noUi?: boolean | undefined;
  noBuiltIns?: boolean | undefined;
  noPlugins?: boolean | undefined;
  open?: boolean | undefined;
  devCors?: boolean | undefined;
  noWatcher?: boolean | undefined;
  watcherDebounceMs?: number | undefined;
  maxScan?: number | undefined;
  maxNodes?: number | undefined;
  watchBackend?: 'chokidar' | 'parcel' | undefined;
}

export type TServerOptionsErrorCode =
  | 'port-out-of-range'
  | 'port-invalid'
  | 'host-not-loopback'
  | 'host-dev-cors-rejected'
  | 'watcher-requires-pipeline'
  | 'watcher-debounce-invalid'
  | 'max-scan-invalid'
  | 'max-nodes-invalid'
  | 'watch-backend-invalid'
  | 'no-ui-conflicts-ui-dist';

export interface IServerOptionsError {
  code: TServerOptionsErrorCode;
  message: string;
  /** The original value the validator rejected, used by the CLI to interpolate the error template. */
  value: string;
}

export type TServerOptionsResult =
  | { ok: true; options: IServerOptions }
  | { ok: false; error: IServerOptionsError };

const DEFAULT_PORT = 4242;
const DEFAULT_HOST = '127.0.0.1';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0:0:0:0:0:0:0:1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

// CLI/server orchestrator with multi-field validation: each `if (error)
// return` adds one cyclomatic point but splits per concern, keeping
// the gate adjacent to the value it gates. Per context/lint.md
// category 1 ("CLI orchestrators with multi-flag handling").
// eslint-disable-next-line complexity
export function validateServerOptions(input: IServerOptionsInput): TServerOptionsResult {
  const filled = applyDefaults(input);

  const portError = validatePort(filled.port);
  if (portError !== null) return { ok: false, error: portError };

  const hostError = validateHost(filled.host, filled.devCors);
  if (hostError !== null) return { ok: false, error: hostError };

  const watcherError = validateWatcher(filled.noWatcher, filled.noBuiltIns, filled.noPlugins);
  if (watcherError !== null) return { ok: false, error: watcherError };

  const debounceError = validateWatcherDebounce(input.watcherDebounceMs);
  if (debounceError !== null) return { ok: false, error: debounceError };

  const maxScanError = validateMaxScan(input.maxScan);
  if (maxScanError !== null) return { ok: false, error: maxScanError };

  const maxNodesError = validateMaxNodes(input.maxNodes);
  if (maxNodesError !== null) return { ok: false, error: maxNodesError };

  const watchBackendError = validateWatchBackend(input.watchBackend);
  if (watchBackendError !== null) return { ok: false, error: watchBackendError };

  const noUiError = validateNoUi(filled.noUi, filled.uiDist);
  if (noUiError !== null) return { ok: false, error: noUiError };

  const options: IServerOptions = {
    port: filled.port,
    host: filled.host,
    dbPath: input.dbPath,
    uiDist: filled.uiDist,
    noUi: filled.noUi,
    noBuiltIns: filled.noBuiltIns,
    noPlugins: filled.noPlugins,
    open: filled.open,
    devCors: filled.devCors,
    noWatcher: filled.noWatcher,
  };
  if (input.watcherDebounceMs !== undefined) {
    options.watcherDebounceMs = input.watcherDebounceMs;
  }
  if (input.maxScan !== undefined) {
    options.maxScan = input.maxScan;
  }
  if (input.maxNodes !== undefined) {
    options.maxNodes = input.maxNodes;
  }
  if (input.watchBackend !== undefined) {
    options.watchBackend = input.watchBackend;
  }
  return { ok: true, options };
}

interface IFilledInput {
  port: number;
  host: string;
  uiDist: string | null;
  noUi: boolean;
  noBuiltIns: boolean;
  noPlugins: boolean;
  open: boolean;
  devCors: boolean;
  noWatcher: boolean;
}

/**
 * Pure column-mapping fold over the input bag, every field's default is
 * read once, with no branching beyond the per-field `??`. Per
 * context/lint.md category 5 ("Pure column mappers, object literals where
 * every `??` adds a cyclomatic branch despite there being zero control flow").
 */
// eslint-disable-next-line complexity
function applyDefaults(input: IServerOptionsInput): IFilledInput {
  return {
    port: input.port ?? DEFAULT_PORT,
    host: input.host ?? DEFAULT_HOST,
    uiDist: input.uiDist ?? null,
    noUi: input.noUi ?? false,
    noBuiltIns: input.noBuiltIns ?? false,
    noPlugins: input.noPlugins ?? false,
    open: input.open ?? true,
    devCors: input.devCors ?? false,
    noWatcher: input.noWatcher ?? false,
  };
}

function validatePort(port: number): IServerOptionsError | null {
  if (!Number.isInteger(port)) {
    return { code: 'port-invalid', message: `port must be an integer (got ${port})`, value: String(port) };
  }
  if (port < 0 || port > 65535) {
    return {
      code: 'port-out-of-range',
      message: `port must be in [0, 65535] (got ${port})`,
      value: String(port),
    };
  }
  return null;
}

function validateHost(host: string, devCors: boolean): IServerOptionsError | null {
  if (isLoopbackHost(host)) return null;
  // Non-loopback bind. The BFF has no auth model (Decision #119, loopback
  // -only pre-1.0), and the DNS-rebinding gate keys on the request
  // `Host`/`Origin` header (port-agnostic, allows the literal `localhost`),
  // so a socket bound off-loopback is reachable by any LAN peer sending
  // `Host: localhost`. Refuse the bind outright rather than leaning on the
  // gate as the sole control. The `--dev-cors` combo keeps its own, more
  // specific message (it implies a browser dev workflow).
  if (devCors) {
    return {
      code: 'host-dev-cors-rejected',
      message: `--dev-cors requires a loopback --host (got ${host})`,
      value: host,
    };
  }
  return {
    code: 'host-not-loopback',
    message: `--host must be a loopback address; multi-host serve is not supported pre-1.0 (got ${host})`,
    value: host,
  };
}

/**
 * The watcher pipeline depends on the same scan composition the
 * one-shot `sm scan` uses, running the watcher with `--no-built-ins`
 * (the only known knob that empties the pipeline) would persist empty
 * scans on every batch. The validator rejects the combination at boot
 * so the operator gets a clear error instead of a silent data wipe.
 *
 * `--no-plugins` is OK alongside the watcher (the built-in pipeline is
 * still complete on its own); only `--no-built-ins + watcher` trips
 * the guard.
 */
function validateWatcher(
  noWatcher: boolean,
  noBuiltIns: boolean,
  _noPlugins: boolean,
): IServerOptionsError | null {
  if (noWatcher) return null;
  if (noBuiltIns) {
    return {
      code: 'watcher-requires-pipeline',
      message:
        'the watcher cannot run with --no-built-ins (would persist empty scans on every batch). Pass --no-watcher to opt out, or drop --no-built-ins.',
      value: 'no-built-ins',
    };
  }
  return null;
}

function validateWatcherDebounce(value: number | undefined): IServerOptionsError | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) {
    return {
      code: 'watcher-debounce-invalid',
      message: `--watcher-debounce-ms must be a non-negative integer (got ${value})`,
      value: String(value),
    };
  }
  return null;
}

function validateMaxScan(value: number | undefined): IServerOptionsError | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) {
    return {
      code: 'max-scan-invalid',
      message: `--max-scan must be an integer >= 1 (got ${value})`,
      value: String(value),
    };
  }
  return null;
}

function validateMaxNodes(value: number | undefined): IServerOptionsError | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) {
    return {
      code: 'max-nodes-invalid',
      message: `--max-nodes must be an integer >= 1 (got ${value})`,
      value: String(value),
    };
  }
  return null;
}

function validateWatchBackend(value: string | undefined): IServerOptionsError | null {
  if (value === undefined) return null;
  if (value !== 'chokidar' && value !== 'parcel') {
    return {
      code: 'watch-backend-invalid',
      message: `--watch-backend must be "chokidar" or "parcel" (got ${value})`,
      value: String(value),
    };
  }
  return null;
}

/**
 * `--no-ui` opts the BFF out of serving any Angular bundle (the dev-mode
 * placeholder takes over). Combining it with an explicit `--ui-dist
 * <path>` is contradictory, the operator can have one OR the other,
 * never both. The CLI catches this before construction; the validator
 * reaffirms so any direct caller of `validateServerOptions` (tests,
 * future programmatic boots) gets the same guarantee.
 */
function validateNoUi(noUi: boolean, uiDist: string | null): IServerOptionsError | null {
  if (noUi && uiDist !== null) {
    return {
      code: 'no-ui-conflicts-ui-dist',
      message: '--no-ui and --ui-dist <path> are mutually exclusive',
      value: uiDist,
    };
  }
  return null;
}
