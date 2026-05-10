/**
 * BFF (Hono) strings emitted by `src/server/**` to stdout / stderr.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Server messages are kept terse — the BFF is a long-running process,
 * not an interactive verb; every line is a server-side log, not user
 * dialogue.
 */

export const SERVER_TEXTS = {
  // Boot banner — printed by the server itself when it begins to listen.
  // The CLI verb `sm serve` formats its own boot banner separately
  // (SERVE_TEXTS.boot) so the two surfaces can diverge if needed.
  listening: 'skill-map server listening on http://{{host}}:{{port}}\n',

  // UI bundle missing — non-fatal when the path was auto-resolved (the
  // server keeps running with an inline placeholder at `/`). Becomes
  // ExitCode.Error when `--ui-dist <path>` was explicit.
  uiBundleMissing:
    'skill-map server: UI bundle not found at {{path}} — serving inline placeholder at "/" (run "npm run build --workspace=ui" to populate).\n',

  // Loopback-only deprecation hint — Decision #119. Logged once at boot
  // when `--host` resolves to a non-loopback address. Multi-host serve
  // re-opens post-v0.6.0.
  hostNonLoopbackHint:
    'skill-map server: --host {{host}} is non-loopback — through v0.6.0 the BFF assumes loopback-only (no auth). See Decision #119 in ROADMAP.\n',

  // Shutdown trace — printed by the close path so test runs that bring
  // the server up and down have a clear marker.
  closed: 'skill-map server: closed.\n',

  // ---- error envelope messages (Step 14.2) ---------------------------------

  // Persisted scan absent and the route can't degrade to an empty result.
  // Hint nudges the user toward `sm scan` so the SPA can call it via the
  // CLI side-by-side with the server.
  dbMissingHint:
    'No persisted scan available at {{path}}. Run `sm scan` to populate the DB.',

  // `?fresh=1` was requested but the server was booted with --no-built-ins
  // or --no-plugins. A fresh scan with neither pipeline yields an empty /
  // partial result that would surprise the SPA. Reject up front.
  freshScanRequiresPipeline:
    '?fresh=1 cannot run while the server was started with --no-built-ins or --no-plugins (would yield empty / partial results).',

  // Unknown formatter on /api/graph — the user asked for a `format` value
  // that no registered formatter advertises. Mirrors `sm graph`'s message.
  graphUnknownFormat:
    'Unknown graph format "{{format}}". Available: {{available}}.',

  // Pagination caps on /api/nodes.
  paginationLimitTooLarge:
    'limit={{value}} exceeds the maximum of {{max}}.',
  paginationInvalidInteger:
    '{{name}}={{value}} is not a non-negative integer.',

  // Node lookup miss on /api/nodes/:pathB64. Both the missing-node and
  // the malformed-pathB64 cases funnel here — the client experience is
  // the same (the resource isn't there).
  nodeNotFound:
    'No node with path "{{path}}".',
  pathB64Malformed:
    'Malformed pathB64 — not a valid base64url-encoded node.path.',

  // ---- WS broadcaster + watcher (Step 14.4.a) ------------------------------

  // Logged once on watcher boot after chokidar's initial walk completes.
  // Marks the broadcaster as armed and the live event stream as flowing.
  watcherReady:
    'skill-map server: watcher ready (roots="{{roots}}", debounceMs={{debounceMs}}).\n',

  // Watcher boot failure inside `createServer`. Non-fatal — the REST
  // surface stays alive so the operator can fix the underlying issue
  // (config, plugin, FS permission) and restart.
  watcherBootFailed:
    'skill-map server: watcher boot failed — {{message}}. /api/* still serving; pass --no-watcher to silence this on the next boot.\n',

  // Per-batch failure inside the watcher's scan+persist pipeline. The
  // watcher loop continues — a transient FS error must not kill the
  // broadcaster.
  watcherBatchFailed:
    'skill-map server: watcher batch failed — {{message}}.\n',

  // chokidar surfaced an error. The watcher stays open per IFsWatcher's
  // contract; the BFF also broadcasts a `watcher.error` advisory so the
  // SPA can surface it in the live event log.
  watcherError:
    'skill-map server: watcher error — {{message}}.\n',

  // chokidar.close() rejected during graceful shutdown. Logged but not
  // surfaced — close() is best-effort and idempotent.
  watcherCloseFailed:
    'skill-map server: watcher close failed — {{message}}.\n',

  // ---- catch-all 404 envelopes (app.ts) ------------------------------------

  // `/api/*` catch-all — request hit the API namespace but no route
  // matched. The path is interpolated so the operator (and the SPA)
  // can see exactly which endpoint was queried.
  unknownApiEndpoint:
    'Unknown API endpoint: {{path}}.',

  // Hono's `app.notFound` fallback — every other unmatched path funnels
  // here (after static + SPA fallback have had their turn).
  unknownPath:
    'Not found: {{path}}.',

  // ---- sidecar bump route (routes/sidecar.ts) ------------------------------

  // 409 refusal when a fresh node is bumped without `force`. The
  // `sidecar-fresh:` prefix is load-bearing — the UI pattern-matches
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

  // 500 envelope when the built-in bump action ships without an
  // `invoke()` — should be impossible in production but the route
  // throws a typed envelope rather than a bare `Error` so the global
  // `app.onError` can format it.
  sidecarBumpInvokeMissing:
    'built-in bump action is missing its invoke().',

  // ---- POST /api/scan (manual refresh) ------------------------------------

  // 400 — runtime cannot persist a meaningful scan because the boot
  // dropped half the pipeline. Same gate the `?fresh=1` GET applies.
  scanPostRequiresFullPipeline:
    'POST /api/scan cannot run while the server was started with --no-built-ins or --no-plugins (would persist a partial DB).',

  // 409 — another scan (watcher batch or another POST) is in flight.
  // The `scan-busy:` prefix is load-bearing: HTTP 409 maps to
  // `scan-busy` in `app.onError`'s `codeForStatus`, but the prefix
  // keeps log-grep affinity with the CLI's `sm scan` verb.
  scanPostBusy:
    'scan-busy: Another scan is already in flight; retry once it finishes.',

  // 500 — DB missing on a write path. Read paths degrade to empty
  // shapes; mutations cannot persist without a DB so they fail fast.
  scanPostDbMissing:
    'Cannot persist scan: project DB not found. Run `sm scan` once or pass --db <path>.',

  // ---- plugins toggle route (routes/plugins.ts) ---------------------------

  // 400 envelopes from `parsePluginPatchBody` — every branch keeps its
  // own key so the UI can disambiguate without regex on the message.
  pluginsBodyNotJson:
    'Request body must be valid JSON.',
  pluginsBodyNotObject:
    'Request body must be a JSON object.',
  pluginsEnabledRequired:
    '`enabled` is required and must be a boolean.',

  // 400 — granularity mismatch. Two flavours so the message is useful
  // when the operator hits the wrong route by hand.
  pluginsGranularityExtensionExpected:
    'Plugin "{{id}}" has granularity:"extension"; toggle individual extensions via PATCH /api/plugins/{{id}}/extensions/<extensionId>.',
  pluginsGranularityBundleExpected:
    'Plugin "{{id}}" has granularity:"bundle"; toggle the whole bundle via PATCH /api/plugins/{{id}}.',

  // 404 — unknown plugin / extension.
  pluginsUnknown:
    'No plugin with id "{{id}}".',
  pluginsExtensionUnknown:
    'Plugin "{{bundleId}}" has no extension named "{{extensionId}}".',

  // 500 — DB missing on a write path. Read paths degrade to empty
  // shapes, but mutations cannot persist without a DB so they fail fast.
  pluginsDbMissing:
    'Cannot persist plugin override: project DB not found at {{path}}. Run `sm scan` first or pass --db <path>.',

  // 403 — host-enforced lock from `src/server/locked-plugins.ts`. The
  // bundle (or qualified extension) is in the hardcoded lock-list and
  // its enabled state is fixed; the UI mirrors the same rule by
  // disabling the toggle.
  pluginsLocked:
    'Plugin "{{id}}" is locked by the host and cannot be toggled.',
  pluginsExtensionLocked:
    'Extension "{{bundleId}}/{{extensionId}}" is locked by the host and cannot be toggled.',

  // ---- preferences route (routes/preferences.ts) --------------------------
  //
  // GET / PATCH /api/preferences. The PATCH body is shaped
  //   `{ updateCheck?: { enabled?: boolean } }`
  // — additive: future user-only preferences (locale, theme) extend the
  // shape under their own sub-key. Each error keeps its own message
  // key so the UI can disambiguate without regex on the body.

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
  // access surface (toggling `includeHome` `false`→`true`, adding
  // out-of-project paths) requires `confirm: true` in the body so a
  // misbehaving client cannot silently widen the scan surface.

  projectPrefsBodyNotJson: 'Request body must be valid JSON.',
  projectPrefsBodyNotObject: 'Request body must be a JSON object.',
  projectPrefsBodyEmpty:
    'Request body must contain a `scan` block with at least one of `includeHome`, `extraRoots`, `referencePaths`.',
  projectPrefsConfirmNotBoolean: '`confirm` must be a boolean.',
  projectPrefsScanNotObject:
    '`scan` must be an object (e.g. `{"scan": {"includeHome": true}}`).',
  projectPrefsIncludeHomeNotBoolean:
    '`scan.includeHome` must be a boolean.',
  projectPrefsListNotArray:
    '`{{key}}` must be an array of strings.',
  projectPrefsListEntryNotString:
    '`{{key}}` entries must be strings.',
  projectPrefsConfirmRequired:
    'This change opens disk access outside the project: {{paths}}. ' +
    'Re-issue the request with `confirm: true` to proceed.',
  projectPrefsPersistFailed:
    'Could not persist `{{key}}`: {{message}}',

  // A connected client's outbound buffer exceeded the backpressure
  // threshold. The broadcaster closes the client with code 1009 and
  // unregisters it. Logged so operators can spot a wedged consumer.
  wsBackpressureEvicted:
    'skill-map server: ws client evicted (bufferedAmount={{buffered}} > threshold={{threshold}}).\n',

  // `WebSocket.send()` threw on a registered client. The client is
  // unregistered; the broadcast continues with the remaining clients.
  wsClientSendFailed:
    'skill-map server: ws send failed — {{message}}.\n',

  // `JSON.stringify(envelope)` threw inside `broadcast()`. The event is
  // dropped. Per spec/job-events.md §Error handling, the right shape
  // is a synthetic `emitter.error` event; v14.4.a does not yet route
  // it through the broadcaster (would re-enter the same stringify
  // path), so we degrade to a logged warning.
  wsBroadcastSerializeFailed:
    'skill-map server: ws broadcast dropped — failed to serialize event: {{message}}.\n',
} as const;
