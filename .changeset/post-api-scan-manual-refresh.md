---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

**Mutex**

A process-level latch (`src/server/scan-mutex.ts`) prevents two POSTs from racing each other. Only the manual POST holds the latch; the watcher's debounced batches stay outside it because `createWatcherRuntime` already serializes its own batches and SQLite WAL serializes the persist transactions, so a watcher × POST race is benign at the storage layer. The latch's job is honest user feedback ("Scan in progress, retry shortly") when their second click arrives before the first scan resolves, not global serialization.

**Errors**

- `409 scan-busy` (new envelope code) — another POST is already in flight. The 409 status is shared with `POST /api/sidecar/bump`'s `sidecar-fresh`, so `app.onError` discriminates by message prefix (`scan-busy:` vs `sidecar-fresh:`); both prefixes were already conventions in the catalog.
- `400 bad-query` — server booted with `--no-built-ins` or `--no-plugins`. Same gate the existing `?fresh=1` GET applies, for the same reason: a partial pipeline would persist a misleading DB.
- `500 db-missing` — project DB absent. Read paths degrade to the empty shape; mutations cannot.

**UI** (private workspace, no separate version bump)

- Topbar refresh button (`pi pi-refresh`) sits between the theme toggle and the settings gear. Tooltip carries the same `X nodes · Y links` counts as the previous info icon. Click → `dataSource.runScan()`; the icon spins (`pi-spin`) and the button is `disabled` while the scan is in flight. Test id: `shell-refresh`.
- New port method `IDataSourcePort.runScan(): Promise<IScanResultApi>` — `RestDataSource` posts to `/api/scan`; `StaticDataSource` rejects with `code: 'demo-readonly'` (the static bundle is immutable).
- The button does NOT manually re-fetch from the loader after the response — the route's WS broadcast already triggers the loader's reactive refresh. The `await this.loader.load()` in the click handler is a belt-and-suspenders fallback for the demo path (no WS) and for races where the WS event fires before the POST promise resolves.

**Internal**

- `IScanRunOpts.emitterFactory` (new optional field on `core/runtime/scan-runner.ts`) — when set, the runner threads the supplied emitter into `runScanWithRenames` instead of building a stderr-bound progress emitter. The watcher already uses the same pattern; the BFF's `POST /api/scan` route now reuses it to plug the broadcaster.
- `buildBroadcasterEmitter` in `src/server/watcher.ts` is now exported so the new route can wire the same emitter the watcher uses.
