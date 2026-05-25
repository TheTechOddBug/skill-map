/**
 * BFF (Hono) strings emitted by `src/server/**` to stdout / stderr.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Server messages are kept terse, the BFF is a long-running process,
 * not an interactive verb; every line is a server-side log, not user
 * dialogue.
 */

export const SERVER_TEXTS = {
  // Boot banner, printed by the server itself when it begins to listen.
  // The CLI verb `sm serve` formats its own boot banner separately
  // (SERVE_TEXTS.boot) so the two surfaces can diverge if needed.
  listening: 'skill-map server listening on http://{{host}}:{{port}}\n',

  // UI bundle missing, non-fatal when the path was auto-resolved (the
  // server keeps running with an inline placeholder at `/`). Becomes
  // ExitCode.Error when `--ui-dist <path>` was explicit.
  uiBundleMissing:
    'skill-map server: UI bundle not found at {{path}} (serving inline placeholder at "/", run "npm run build --workspace=ui" to populate).\n',

  // Loopback-only deprecation hint, Decision #119. Logged once at boot
  // when `--host` resolves to a non-loopback address. Multi-host serve
  // re-opens post-v0.6.0.
  hostNonLoopbackHint:
    'skill-map server: --host {{host}} is non-loopback (through v0.6.0 the BFF assumes loopback-only, no auth). See Decision #119 in ROADMAP.\n',

  // Shutdown trace, printed by the close path so test runs that bring
  // the server up and down have a clear marker.
  closed: 'skill-map server: closed.\n',

  // ---- error envelope messages (Step 14.2) ---------------------------------

  // Persisted scan absent and the route can't degrade to an empty result.
  // Hint nudges the user toward `sm scan` so the SPA can call it via the
  // CLI side-by-side with the server.
  dbMissingHint:
    'No persisted scan available at {{path}}. Run `sm scan` to populate the DB.',

  // First-stage loopback gate (DNS rebinding + cross-origin defence). The
  // messages are pre-baked, terse, and shared across every probe so the
  // response stays opaque (no per-request state leaks). The discriminator
  // travels on `error.code`; the message is informational only.
  hostNotAllowed:
    'Request rejected: Host header is not loopback.',
  originNotAllowed:
    'Request rejected: Origin header is not loopback.',

  // `?fresh=1` was requested but the server was booted with --no-built-ins
  // or --no-plugins. A fresh scan with neither pipeline yields an empty /
  // partial result that would surprise the SPA. Reject up front.
  freshScanRequiresPipeline:
    '?fresh=1 cannot run while the server was started with --no-built-ins or --no-plugins (would yield empty / partial results).',

  // Unknown formatter on /api/graph, the user asked for a `format` value
  // that no registered formatter advertises. Mirrors `sm graph`'s message.
  graphUnknownFormat:
    'Unknown graph format "{{format}}". Available: {{available}}.',

  // Pagination caps on /api/nodes.
  paginationLimitTooLarge:
    'limit={{value}} exceeds the maximum of {{max}}.',
  paginationInvalidInteger:
    '{{name}}={{value}} is not a non-negative integer.',

  // Required-query-param miss (used by `parseRequiredString`). The
  // route names the offending parameter so the operator gets a useful
  // 400 instead of a generic "missing input".
  queryRequiredString:
    'Required query parameter: {{name}}.',

  // Malformed URL-path segment on a route whose params follow the
  // qualified-id alphabet (`[A-Za-z0-9._-]`). Surfaces on the
  // contributions lookup route (`/api/contributions/:pluginId/:extensionId/:contributionId`)
  // so a request with a slash, space, or control char in any segment
  // returns 400 before the kernel lookup.
  qualifiedIdMalformed:
    '{{name}}="{{value}}" is not a valid qualified-id segment ([A-Za-z0-9._-]+).',

  // 404 envelope for `/api/contributions/:pluginId/:extensionId/:contributionId`
  // when the catalog has no matching entry. Interpolates the full
  // triple so the SPA / operator can see which qualified id missed.
  contributionUnknown:
    'No registered contribution: {{pluginId}}/{{extensionId}}/{{contributionId}}.',

  // 400 envelope on /api/graph when `?format=` arrives with an invalid
  // shape (too long, or characters outside the formatter-id alphabet).
  // Caught BEFORE the registry lookup so a hostile value never reaches
  // the formatter table.
  graphFormatMalformed:
    'format="{{value}}" is not a valid formatter id (lowercase a-z, 0-9, hyphen, max 32 chars).',

  // POST /api/scan + GET /api/scan?fresh=1, the runner returned a
  // `guard-trip` outcome (an idempotency / safety latch in the kernel).
  // Surfaced as a 500 with the offending row-count.
  scanGuardTrip:
    'scan refused (existing rows: {{existing}})',
  freshScanGuardTrip:
    'fresh scan refused (existing rows: {{existing}})',

  // Node lookup miss on /api/nodes/:pathB64. Both the missing-node and
  // the malformed-pathB64 cases funnel here, the client experience is
  // the same (the resource isn't there).
  nodeNotFound:
    'No node with path "{{path}}".',
  pathB64Malformed:
    'Malformed pathB64, not a valid base64url-encoded node.path.',

  // ---- WS broadcaster + watcher (Step 14.4.a) ------------------------------

  // Logged once on watcher boot after chokidar's initial walk completes.
  // Marks the broadcaster as armed and the live event stream as flowing.
  watcherReady:
    'skill-map server: watcher ready (roots="{{roots}}", debounceMs={{debounceMs}}).\n',

  // Watcher boot failure inside `createServer`. Non-fatal, the REST
  // surface stays alive so the operator can fix the underlying issue
  // (config, plugin, FS permission) and restart.
  watcherBootFailed:
    'skill-map server: watcher boot failed ({{message}}). /api/* still serving; pass --no-watcher to silence this on the next boot.\n',

  // Per-batch failure inside the watcher's scan+persist pipeline. The
  // watcher loop continues, a transient FS error must not kill the
  // broadcaster.
  watcherBatchFailed:
    'skill-map server: watcher batch failed ({{message}}).\n',

  // chokidar surfaced an error. The watcher stays open per IFsWatcher's
  // contract; the BFF also broadcasts a `watcher.error` advisory so the
  // SPA can surface it in the live event log.
  watcherError:
    'skill-map server: watcher error ({{message}}).\n',

  // chokidar.close() rejected during graceful shutdown. Logged but not
  // surfaced, close() is best-effort and idempotent.
  watcherCloseFailed:
    'skill-map server: watcher close failed ({{message}}).\n',

  // ---- body-limit middleware (app.ts, audit M4) ---------------------------

  // 413 envelope when a request body exceeds the global `BODY_LIMIT_BYTES`
  // cap. The discriminator travels on `error.code` (`payload-too-large`);
  // the message is informational only and names the byte cap so the
  // operator / SPA log can correlate without re-reading the source.
  bodyTooLarge:
    'Request body exceeds the {{maxBytes}}-byte limit.',

  // ---- onError fall-through (app.ts, audit L3) ----------------------------

  // 500 envelope for any throw that doesn't match a known mapped subclass
  // (DbMissingError, BulkValidationError, LoopbackGateError, HTTPException,
  // ExportQueryError, EConsentRequiredError). The raw err.message often
  // carries kernel detail (absolute paths, registry-probe hostnames),
  // so we redact the human-readable text to a generic constant and route
  // the real detail to log.warn instead. The envelope `code` stays
  // `internal`; `details` stays `null`. Operators see the full message
  // on stderr / log file via the BFF's logger.
  internalError:
    'internal error',

  // ---- catch-all 404 envelopes (app.ts) ------------------------------------

  // `/api/*` catch-all, request hit the API namespace but no route
  // matched. The path is interpolated so the operator (and the SPA)
  // can see exactly which endpoint was queried.
  unknownApiEndpoint:
    'Unknown API endpoint: {{path}}.',

  // Hono's `app.notFound` fallback, every other unmatched path funnels
  // here (after static + SPA fallback have had their turn).
  unknownPath:
    'Not found: {{path}}.',

  // ---- sidecar bump route (routes/sidecar.ts) ------------------------------

  // 409 refusal when a fresh node is bumped without `force`. The
  // `sidecar-fresh:` prefix is load-bearing, the UI pattern-matches
  // it (the global `app.onError` already maps HTTP 409 to the
  // `sidecar-fresh` envelope `code`, so the prefix is for log-grep
  // affinity with the CLI's bump verb).
  sidecarFreshRefusal:
    'sidecar-fresh: Node is fresh; pass force:true to bump anyway.',

  // 400 envelopes thrown by `parseBody` when the request payload is
  // malformed. Each branch has its own key so the UI / log can
  // disambiguate without regex on the message.
  sidecarBodyNotJson:
    'Request body must be valid JSON.',
  sidecarBodyNotObject:
    'Request body must be a JSON object.',
  sidecarNodePathRequired:
    '`nodePath` is required and must be a non-empty string.',
  sidecarForceMustBeBoolean:
    '`force` must be a boolean when present.',
  sidecarConfirmMustBeBoolean:
    '`confirm` must be a boolean when present.',
  /**
   * 412 envelope when `POST /api/sidecar/bump` would create a `.sm`
   * file but `allowEditSmFiles` is still false. The UI's bump
   * call-path catches `code: 'confirm-required'` and opens a
   * `ConfirmationService` dialog explaining `.sm` writes; on accept
   * it retries with `confirm: true` in the body.
   */
  sidecarConsentRequired:
    'consent required to write .sm sidecar files in this project. Retry with `confirm: true` to grant (writes to .skill-map/settings.local.json, gitignored).',

  // 500 envelope when the built-in bump action ships without an
  // `invoke()`, should be impossible in production but the route
  // throws a typed envelope rather than a bare `Error` so the global
  // `app.onError` can format it.
  sidecarBumpInvokeMissing:
    'built-in bump action is missing its invoke().',

  // ---- POST /api/scan (manual refresh) ------------------------------------

  // 400, runtime cannot persist a meaningful scan because the boot
  // dropped half the pipeline. Same gate the `?fresh=1` GET applies.
  scanPostRequiresFullPipeline:
    'POST /api/scan cannot run while the server was started with --no-built-ins or --no-plugins (would persist a partial DB).',

  // 409, another scan (watcher batch or another POST) is in flight.
  // The `scan-busy:` prefix is load-bearing: HTTP 409 maps to
  // `scan-busy` in `app.onError`'s `codeForStatus`, but the prefix
  // keeps log-grep affinity with the CLI's `sm scan` verb.
  scanPostBusy:
    'scan-busy: Another scan is already in flight; retry once it finishes.',

  // 500, DB missing on a write path. Read paths degrade to empty
  // shapes; mutations cannot persist without a DB so they fail fast.
  scanPostDbMissing:
    'Cannot persist scan: project DB not found. Run `sm scan` once or pass --db <path>.',

  // ---- plugins toggle route (routes/plugins.ts) ---------------------------

  // 400 envelopes from `parsePluginPatchBody`, every branch keeps its
  // own key so the UI can disambiguate without regex on the message.
  pluginsBodyNotJson:
    'Request body must be valid JSON.',
  pluginsBodyNotObject:
    'Request body must be a JSON object.',
  pluginsEnabledRequired:
    '`enabled` is required and must be a boolean.',

  // 400, cascade route rejects qualified ids: the bare-id PATCH is the
  // bundle macro endpoint. Anything containing `/` needs the dedicated
  // per-extension route below.
  pluginsCascadeRouteQualifiedRejected:
    'Plugin id "{{id}}" contains "/"; toggle individual extensions via PATCH /api/plugins/<bundle>/extensions/<extensionId>.',

  // 404, unknown plugin / extension.
  pluginsUnknown:
    'No plugin with id "{{id}}".',
  pluginsExtensionUnknown:
    'Plugin "{{bundleId}}" has no extension named "{{extensionId}}".',

  // 500, DB missing on a write path. Read paths degrade to empty
  // shapes, but mutations cannot persist without a DB so they fail fast.
  pluginsDbMissing:
    'Cannot persist plugin override: project DB not found at {{path}}. Run `sm scan` first or pass --db <path>.',

  // 403, host-enforced lock from `src/server/locked-plugins.ts`. The
  // bundle (or qualified extension) is in the hardcoded lock-list and
  // its enabled state is fixed; the UI mirrors the same rule by
  // disabling the toggle.
  pluginsLocked:
    'Plugin "{{id}}" is locked by the host and cannot be toggled.',
  pluginsExtensionLocked:
    'Extension "{{bundleId}}/{{extensionId}}" is locked by the host and cannot be toggled.',

  // 400 envelopes specific to the bulk `PATCH /api/plugins` endpoint.
  // The single-id variants above still apply for per-entry validation
  // (unknown id, granularity mismatch, lock); these cover the
  // body-shape level.
  pluginsChangesRequired:
    'Request body must include a `changes` array of `{ id, enabled }` entries.',
  pluginsChangeMalformed:
    'Each entry in `changes` must have a string `id` and a boolean `enabled`.',

  // ---- preferences route (routes/preferences.ts) --------------------------
  //
  // GET / PATCH /api/preferences. The PATCH body is shaped
  //   `{ updateCheck?: { enabled?: boolean } }`
  // additive: future per-machine preferences (locale, theme) extend
  // the shape under their own sub-key. Each error keeps its own
  // message key so the UI can disambiguate without regex on the body.

  preferencesBodyNotJson: 'Request body must be valid JSON.',
  preferencesBodyNotObject: 'Request body must be a JSON object.',
  preferencesBodyEmpty:
    'Request body must contain at least one known preference (e.g. `updateCheck.enabled`).',
  preferencesUpdateCheckNotObject:
    '`updateCheck` must be an object (e.g. `{"updateCheck": {"enabled": false}}`).',
  preferencesUpdateCheckEnabledNotBoolean:
    '`updateCheck.enabled` must be a boolean.',
  preferencesPersistFailed:
    'Could not persist preferences: {{message}}',

  // ---- project-preferences route (routes/project-preferences.ts) ----------
  //
  // GET / PATCH /api/project-preferences. Body shape mirrors the
  // settings.json `scan.*` block; every PATCH that EXPANDS the disk-
  // access surface (adding out-of-project paths) requires
  // `confirm: true` in the body so a misbehaving client cannot
  // silently widen the scan surface.

  projectPrefsBodyNotJson: 'Request body must be valid JSON.',
  projectPrefsBodyNotObject: 'Request body must be a JSON object.',
  projectPrefsBodyEmpty:
    'Request body must contain a `scan` block with `referencePaths`.',
  projectPrefsConfirmNotBoolean: '`confirm` must be a boolean.',
  projectPrefsScanNotObject:
    '`scan` must be an object (e.g. `{"scan": {"referencePaths": ["~/Documents"]}}`).',
  projectPrefsListNotArray:
    '`{{key}}` must be an array of strings.',
  projectPrefsListEntryNotString:
    '`{{key}}` entries must be strings.',
  projectPrefsConfirmRequired:
    'This change opens disk access outside the project: {{paths}}. ' +
    'Re-issue the request with `confirm: true` to proceed.',
  projectPrefsPersistFailed:
    'Could not persist `{{key}}`: {{message}}',
  // Returned for every NEW entry that does not resolve to an existing
  // directory on disk. The list is comma-separated; pre-existing
  // entries are not re-validated.
  projectPrefsPathNotFound:
    'These folders do not exist on disk: {{paths}}. Add only paths that already exist.',
  // AJV `pattern` violation, an entry contains a comma. The UI rejects
  // comma input client-side; this message is the server-side safety
  // net (defense in depth).
  projectPrefsEntryHasComma:
    'Folder entries must not contain commas. Add one folder per entry.',
  // Server-stderr advisories emitted by `PATCH /api/project-preferences`
  // after a successful write. The operator running `sm serve` sees
  // each add / remove on the console without opening the config file.
  // `{{detail}}` is composed in JS (see `formatPathDetail`) so the
  // single template covers all three path shapes (home / relative /
  // absolute) without a template explosion.
  projectPrefsPathAdded:
    'project-prefs: + {{key}} {{detail}}',
  projectPrefsPathRemoved:
    'project-prefs: - {{key}} {{detail}}',
  // `PATCH /api/project-preferences` mutated `scan.*` and the
  // post-write `watcherService.restart()` call threw. The on-disk
  // write itself succeeded; the operator sees this advisory and
  // restarts the server to pick up the new root list manually.
  projectPrefsWatcherRestartFailed:
    'project-prefs: watcher restart after scan-config write failed ({{message}}). Restart `sm serve` to pick up the new roots.',

  // ---- project-ignore route (routes/project-ignore.ts) -------------------
  //
  // GET / PATCH /api/project-ignore. Backing is the project-root
  // `.skillmapignore` file (gitignore-syntax). Comments and blank
  // lines are preserved on write; only the active pattern list is
  // exchanged over the wire. No privacy gate, the patterns narrow the
  // scan surface and never widen disk access.

  projectIgnoreBodyNotJson: 'Request body must be valid JSON.',
  projectIgnoreBodyNotObject: 'Request body must be a JSON object.',
  projectIgnoreBodyEmpty:
    'Request body must contain a `patterns` array.',
  projectIgnoreListNotArray:
    '`patterns` must be an array of strings.',
  projectIgnoreEntryNotString:
    '`patterns` entries must be strings.',
  // AJV `minLength: 1` on each pattern after the route trims server-side;
  // surfaces when the operator sends `"   "` or an empty string.
  projectIgnorePatternEmpty:
    'Pattern entries must not be empty or whitespace-only.',
  // AJV `pattern` violation: a single pattern carried a newline,
  // carriage return, or other ASCII control character. The UI rejects
  // these client-side; this message is the server-side safety net.
  projectIgnorePatternHasControlChar:
    'Pattern entries must be a single line without control characters.',
  // Duplicate detection runs after trim; the UI rejects duplicates
  // client-side, this is the server-side safety net.
  projectIgnorePatternDuplicate:
    'Duplicate pattern: "{{pattern}}". Each pattern must be unique.',
  projectIgnorePersistFailed:
    'Could not persist `.skillmapignore`: {{message}}',
  projectIgnorePatternAdded:
    'project-ignore: + {{pattern}}',
  projectIgnorePatternRemoved:
    'project-ignore: - {{pattern}}',
  projectIgnoreWatcherRestartFailed:
    'project-ignore: watcher restart after `.skillmapignore` write failed ({{message}}). Restart `sm serve` to pick up the new filter.',

  // A connected client's outbound buffer exceeded the backpressure
  // threshold. The broadcaster closes the client with code 1009 and
  // unregisters it. Logged so operators can spot a wedged consumer.
  wsBackpressureEvicted:
    'skill-map server: ws client evicted (bufferedAmount={{buffered}} > threshold={{threshold}}).\n',

  // `WebSocket.send()` threw on a registered client. The client is
  // unregistered; the broadcast continues with the remaining clients.
  wsClientSendFailed:
    'skill-map server: ws send failed ({{message}}).\n',

  // `JSON.stringify(envelope)` threw inside `broadcast()`. The event is
  // dropped. Per spec/job-events.md §Error handling, the right shape
  // is a synthetic `emitter.error` event; v14.4.a does not yet route
  // it through the broadcaster (would re-enter the same stringify
  // path), so we degrade to a logged warning.
  wsBroadcastSerializeFailed:
    'skill-map server: ws broadcast dropped, failed to serialize event: {{message}}.\n',

  // ---- active-provider route (routes/active-provider.ts) -----------
  //
  // GET / PUT /api/active-provider. The active provider lens selects
  // which provider's extractors / classifiers / resolution rules apply
  // to the whole project (see `architecture.md` §Active Provider Lens).
  // Changing the lens drops the `scan_*` zone atomically and prompts
  // the user to re-scan; `state_*` and `config_*` survive.

  activeProviderBodyNotJson: 'Request body must be valid JSON.',
  activeProviderBodyNotObject: 'Request body must be a JSON object.',
  activeProviderBodyMissing:
    'Request body must include `activeProvider` (a non-empty string).',
  activeProviderValueNotString: '`activeProvider` must be a string.',
  activeProviderValueEmpty:
    '`activeProvider` cannot be the empty string. Send the id of an enabled provider.',
  activeProviderPersistFailed:
    'Could not persist activeProvider: {{message}}',
} as const;
