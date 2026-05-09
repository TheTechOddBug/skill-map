---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

**BFF**

- `PATCH /api/plugins/:id` — toggle a granularity=`bundle` plugin's user override. Body `{ enabled: boolean }`. Persists to `config_plugins` via the same `IConfigPluginsPort.set` path the CLI's `sm plugins enable / disable` uses. Response: the projected list (same shape as `GET /api/plugins`) so callers replace state in one shot.
- `PATCH /api/plugins/:bundleId/extensions/:extensionId` — qualified-id form for granularity=`extension` bundles (today: `core` plus any user plugin that opts in).
- Granularity is enforced symmetrically: bundle-form against an extension-only bundle returns 400 `bad-query`; qualified-form against a bundle-only target returns the same. Unknown plugin / extension ids return 404 `not-found`. Missing project DB returns 500 `db-missing` (read-side endpoints still degrade to empty shapes; mutations cannot persist without a DB so they fail fast).
- `GET /api/plugins` items now carry `granularity: 'bundle' | 'extension'` and an optional `extensions[]` array (present only for granularity=`extension` plugins) so the UI can render expandable per-extension toggles for `core` without a second round-trip.

**Restart caveat**

The loaded plugin runtime is boot-cached; toggle changes apply on the next `sm scan` or `sm serve` restart. The endpoint does NOT broadcast a WS event today. The Settings modal renders a persistent `<p-message severity="warn">` banner ("Restart required") so users aren't surprised when their toggle doesn't immediately re-render the graph.

**UI** (private workspace, no separate version bump)

- Gear icon in the topbar (`shell__actions`) opens a PrimeNG `p-dialog` modal. The modal is `@defer`-loaded so the Dialog + ToggleSwitch + Message chunks (~57 KB) only ride the wire on first open.
- Each plugin row is one `p-toggleswitch` for granularity=`bundle`; granularity=`extension` rows expand to reveal per-extension toggles. Failure-mode plugins (`incompatible-spec`, `invalid-manifest`, `load-error`, `id-collision`) render with their reason and no toggle (toggling enabled doesn't unbreak a broken plugin).
- Test ids per the project convention: `action-settings`, `settings-modal`, `settings-banner-restart`, `settings-row-<id>`, `settings-toggle-<id>`, `settings-bundle-expand-<id>`, `settings-extrow-<bundle>-<ext>`, `settings-ext-toggle-<bundle>-<ext>`.

**Decision: no hot-reload**

Toggling does not recompose the plugin runtime in-process. A hot-reload path would need to invalidate the kind registry, contributions registry, route-level decorators, and any in-flight scan; all for a modal that's used once or twice per session. The restart caveat is the spec'd contract; revisit if and when watcher-driven toggles become a common workflow.
