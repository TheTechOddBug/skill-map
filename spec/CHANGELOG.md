# Spec changelog

## 0.22.0

### Minor Changes

- 39a61e9: Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

  **Removed**

  - `scan.includeHome` (project config boolean). The toggle that appended every Provider's HOME path is gone.
  - `explorationDir` on the Provider manifest. Built-in providers (`claude`, `gemini`, `agent-skills`, `core-markdown`) no longer declare it; the field is dropped from `spec/schemas/extensions/provider.schema.json`. Each Provider's walker hardcodes the project-relative paths it cares about (e.g. `.claude/`, `.gemini/`, `.agents/`).
  - `sm scan -g` / `sm scan --global`. The scan verb no longer accepts the global scope flag (there is no global scan surface once HOME auto-inclusion is gone). Other verbs (`config`, `db`, `plugins`, `init`, …) keep their `-g` flag — those point at `~/.skill-map/` (skill-map's own data dir), not at scanned content.
  - `sm plugins doctor` no longer emits the `explorationDir missing` warning.

  **Renamed**

  - `scan.extraRoots` → `scan.extraFolders` (same shape `string[]`, same semantics — clearer name in the Settings UI and config). Privacy-sensitive: writes that add out-of-project paths still require `--yes` on the CLI and a confirm dialog in the UI.

  **BFF**

  - `GET /api/project-preferences` response now returns `{ scan: { extraFolders, referencePaths } }` (dropped `includeHome`, renamed `extraRoots`).
  - `PATCH /api/project-preferences` accepts the same shape; `additionalProperties: false` still applies.

  **UI**

  - Settings → Project section drops the "Include HOME folders" toggle; only the "Extra folders to scan" list and "Folders for link validation" list remain.

  **Greenfield migration**

  No backwards-compat shim. Users with `scan.includeHome: true` or `scan.extraRoots: [...]` in `<cwd>/.skill-map/settings.local.json` (or `~/.skill-map/settings.json`) need to manually rename `extraRoots` → `extraFolders` and, if they want to keep HOME scanning, list the specific paths they care about (e.g. `~/.claude/agents`) in `scan.extraFolders` — instead of opting into "everything under HOME" at once.

  ## User-facing

  The "include HOME" toggle is gone. To scan paths outside the project, list them in **Extra folders to scan** (renamed from _Extra roots_). If you had `scan.includeHome: true`, add the paths you actually need (e.g. `~/.claude/agents`) — not one click anymore.

### Patch Changes

- 1e48d2e: Follow-up sweep on the cli-architect spec-drift audit. Three pieces:

  - **5a — plugin loader status alignment.** The loader now returns `invalid-manifest` (not `load-error`) when the exported extension shape fails its kind-specific AJV schema. Aligns with `spec/architecture.md` §Plugin discovery: "AJV rejects unknown `slot` names with `invalid-manifest`". The module imported fine; only the declared shape is wrong, so `invalid-manifest` is the semantically correct status (`load-error` is for genuine module-load failures: import threw, timeout, unknown kind). Renames `PLUGIN_LOADER_TEXTS.loadErrorManifestInvalid` → `invalidManifestExtensionShape` to match. 4 tests updated.

  - **7 — `emitScopeContribution` docs alignment.** Added a "pending, not yet implemented" status note to `spec/view-slots.md` and `spec/plugin-author-guide.md`. The two author-facing docs previously showed the callback as if it existed; `spec/architecture.md` already says it's "reserved, lands when the first scope-level adopter arrives". A plugin author who copies the example now sees the caveat upfront instead of hitting `TypeError: ctx.emitScopeContribution is not a function` at runtime.

  - **P2 cosmetic prose sweep.** Slot-count references corrected ("15 slots" → "14" — the closed enum has 14 entries since the topbar scope-slot rename); `IViewContribution` field count corrected ("six fields" → "seven" — `priority?` was declared in the schema since the beginning but never documented in prose). Three spec docs swept; `spec/index.json` regenerated.

  `catalogCompat` (5b in the audit) — schema field declared but loader check not implemented — is deferred until catalog v2 evolution demands it. No catalog evolution is pending pre-1.0, so the gap is acceptable; flagged in audit follow-ups, not in this changeset.

## 0.21.0

### Minor Changes

- f72dbfc: Card body + topbar polish, plus catalog rename of the topbar scope slot.

  **New extractor (`core/tools-count`)** — `src/built-in-plugins/extractors/tools-count/`. Reads `frontmatter.tools[]` on agent-kind nodes (Claude + Gemini share the field shape) and emits a `card.footer.left` counter chip with a wrench icon. Replaces the hardcoded wrench block previously rendered straight from `<sm-node-card>` (`toolsCount()` computed + `effectiveToolsCount` / `effectiveToolsBreakdown` helpers, all removed). `applicableKinds: ['agent']` gates the run at load time so skill / command / markdown nodes pay zero cost. Tooltip carries the joined tool names (capped at the 256-char slot limit).

  **Provider kind visuals normalised** — `src/built-in-plugins/providers/gemini/index.ts` and `agent-skills/index.ts`. Every Provider that contributes `agent` / `skill` / `command` now declares the same label + color + icon as Claude. The declaration STAYS per-Provider (the shape allows divergence the day a Provider wants its own identity for a kind), but today the values mirror Claude so the visual vocabulary is uniform regardless of where a node was sourced from. `<sm-kind-icon>` gains an optional `provider` input that resolves the icon per-Provider when the call site supplies one (today a no-op, ready to diverge tomorrow).

  **Slot catalog rename + relocate** — `topbar.actions.indicator` → `topbar.nav.start`. The slot moved from the topbar actions cluster (right side, between refresh / theme / settings) to the start of the topbar nav (left of the view-switcher links). The rename is a catalog-major-bump for any external plugin that emitted to the old name (pre-1.0 → ships as a `@skill-map/spec` minor per the versioning policy). Sweep covers `spec/schemas/view-slots.schema.json` (closed enum), `spec/view-slots.md`, `spec/architecture.md`, `spec/plugin-author-guide.md`, `src/kernel/types/view-catalog.ts`, `src/kernel/adapters/schema-validators.ts`, `src/built-in-plugins/analyzers/unknown-slot/index.ts`, `src/cli/commands/plugins.ts`, `ui/src/app/slots/slot-config.ts`, `ui/src/app/slots/slot-renderer-map.ts`, `ui/src/app/app.html`, `ui/src/app/renderers/scope-stat/scope-stat.ts`, `ui/src/app/debug-slots.css`, `context/view-slots.md`, `ROADMAP.md`. Spec integrity regenerated.

  **View-contribution wrapper transparent to layout** — `ui/src/app/debug-slots.css`. `.sm-debug-slot` and `<sm-view-contributions-host>` are `display: contents` in production mode, so a slot that has no contributions takes zero space (no flex gap, no empty box). Debug mode flips both back to `inline-flex` for the visual ring + label.

  **Provider chip in card subtitle** — `ui/src/services/provider-ui.ts` (new) + render in `<sm-node-card>`. Hardcoded chip carrying the provider's display label, color-coded per Provider so the platform a node came from reads at a glance. Unlike kind visuals (normalised), provider visuals are deliberately distinct. The `markdown` Provider is hidden (universal fallback — every generic `.md` lands there, painting the chip would be visual noise). Today the registry is a static UI-side map; promotes to a kernel-side `IProvider.ui` field the day a user-plugin Provider needs to declare its own chip.

  **Path row in expanded card** — `ui/src/app/components/node-card/node-card.html`. Mono row at the top of `.sm-gnode__panel`, above the description and the LLM cluster. Subtle background, ellipsis on the leading segments (RTL trick) so the file name stays visible on long paths.

  **Stat chip colors decoupled from `--sm-kind-*`** — `ui/src/styles.css` declares `--sm-stat-tokens-bg` / `--sm-stat-bytes-bg` / `--sm-stat-date-bg` (light + dark). Previously the chip backgrounds borrowed `--sm-kind-agent` / `--sm-kind-command` / `--sm-kind-skill`, which evaporate when their primary Provider plugin is disabled. Physical stats are plugin-independent — the new tokens keep the chips colored regardless of which plugins contribute kinds.

  **Favorite star (was heart)** — every favorite affordance flips from `pi-heart` / `pi-heart-fill` to `pi-star` / `pi-star-fill`: `<sm-node-card>`, `<sm-inspector-view>`, `<app-kind-palette>` (favorites toggle), `<app-filter-bar>` (favorites toggle). Spec describes match updated.

  **Author tag chips inherit the card's kind accent** — `node-card.css`. Outline color + text color come from `var(--accent)` (the kind's primary color, overridden per-Provider by `providerAccent`) instead of the theme's violet primary. Each card paints author tags in its own kind color.

  ## User-facing

  Expanded node cards now show the file path above the description and a provider chip (Claude, Gemini, Open Skills). Favorite toggle uses a star instead of a heart.

- 5ed14cb: Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

  Both toggle paths converge on the same purge:

  - CLI — `sm plugins disable <id>` and `sm plugins disable --all` (`TogglePluginsBase.toggle` in `src/cli/commands/plugins.ts`).
  - BFF — `PATCH /api/plugins/:id` and `PATCH /api/plugins/:bundleId/extensions/:extensionId` (the UI's Settings → Plugins toggle).

  Each call to `pluginConfig.set(id, false)` is followed by `adapter.contributions.purgeByPlugin(pluginId, extensionId?)`. `extensionId` is omitted for bundle-granularity ids (`claude`) and supplied for qualified ids (`core/slash`), mirroring how the catalog sweep groups rows. Re-enabling does NOT restore the rows — the next scan re-emits them, same as a cold start.

  Plugin-managed state (`state_plugin_kvs`, dedicated `plugin_<id>_*` tables) is **not** touched. The asymmetry is intentional: contributions are scan-derived (cheap to recompute, must reflect the live catalog), KV / dedicated-table state is plugin-managed and must survive toggle cycles. See `spec/plugin-kv-api.md` and `spec/db-schema.md` for the contract.

  **Spec changes** (`@skill-map/spec` minor — new method on `StoragePort.contributions`):

  - `spec/architecture.md` § View contribution system → Persistence — catalog sweep now narrowed to "uninstalled-on-disk plugins, removed contributions"; eager-purge-on-disable documented as the primary path for disabled bundles.
  - `spec/db-schema.md` § `scan_contributions` — same narrowing; new "Eager purge on disable" subsection describing `purgeByPlugin(pluginId, extensionId?)`.
  - `spec/cli-contract.md` § Plugins — `sm plugins disable` row mentions the immediate purge.
  - `spec/plugin-author-guide.md` § Plugin states — `disabled` row mentions the immediate purge.
  - `spec/plugin-kv-api.md` § Backup and retention — clarifies the asymmetry between `scan_contributions` (purged) and KV / dedicated tables (preserved).

  **Implementation** (`@skill-map/cli` patch):

  - `src/kernel/adapters/sqlite/contributions.ts` — `purgeContributionsByPlugin(db, pluginId, extensionId?)` now optionally narrows by extension.
  - `src/kernel/ports/storage.ts` — `StoragePort.contributions.purgeByPlugin(pluginId, extensionId?)` added to the contract.
  - `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the namespace method to the helper.
  - `src/cli/commands/plugins.ts` — toggle base class calls the purge when `enabled === false`.
  - `src/server/routes/plugins.ts` — `persistAndProject` calls the purge when `enabled === false`.
  - `ui/src/app/components/settings-modal/settings-plugins.ts` — after a successful UI toggle, calls `CollectionLoaderService.load()` so the cached in-memory `node.contributions[]` is refreshed against the just-purged DB and the card chips disappear without the user pressing Refresh. The loader's existing `pendingRefresh` collapsing semantics handle back-to-back toggles cheaply.

  **Tests**:

  - `src/test/view-contributions.test.ts` — new unit test asserting `purgeByPlugin` narrows by `extensionId` when supplied.
  - `src/test/plugins-cli.test.ts` — new end-to-end test asserting `sm plugins disable <id>` drops the plugin's `scan_contributions` rows while leaving unrelated plugin rows untouched.
  - `ui/src/app/components/settings-modal/settings-plugins.spec.ts` — new test asserting the toggle handler calls `CollectionLoaderService.load()` so the card chips reflect the BFF purge. (The pre-existing `settings-plugins.spec.ts` suite is currently broken on `main` for unrelated reasons — `verifySemanticsOfNgModuleDef` Angular DI failure across 24 UI test files — but the new test is correctly written and will activate once that suite is fixed.)

  ## User-facing

  Disabling a plugin now removes its card chips from the UI immediately. Previously the chips lingered until the next `sm scan`, making the toggle look broken.

- fe13254: Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

  **Spec (`@skill-map/spec`) — `view-slots.schema.json#/$defs/IconString`**

  The `IconString` `$def` gains a `pattern` enforcing the new grammar and an updated `description`:

  ```
  ^(?:pi pi-[a-z0-9-]+|pi-[a-z0-9-]+|fa-(?:solid|regular|brands) fa-[a-z0-9-]+|fa-[a-z0-9-]+|[^a-zA-Z].*)$
  ```

  Four valid shapes:

  1. **Emoji** — any value starting with a non-ASCII-letter codepoint (`'🔍'`, `'@'`) renders as text.
  2. **PrimeIcons** — `'pi-foo'` or `'pi pi-foo'` (both accepted) → `<i class="pi pi-foo">`.
  3. **FontAwesome explicit family** — `'fa-solid fa-foo'` / `'fa-regular fa-foo'` / `'fa-brands fa-foo'` → pass-through.
  4. **FontAwesome shorthand** — `'fa-foo'` → defaults to `<i class="fa-solid fa-foo">`.

  Bare class names without a `pi-` / `fa-` prefix (`'star-fill'`, `'search'`, `'arrow-down'`) are **rejected at manifest load with `invalid-manifest`**. Prose contract in `spec/view-slots.md` §Icon string and `spec/plugin-author-guide.md` (icon row of the field reference table + new "Icon string forms" subsection) updated to match. `spec/index.json` regenerated.

  **Greenfield path — no shim, no version flag**

  Per `AGENTS.md` `Greenfield = no schema versioning`: no released external plugin uses the bare-name shape (the built-ins are the only consumers and ship in the same repo), so we tighten the contract in place. No `catalogCompat` bump on the catalog, no migration step registered in `sm plugins upgrade`. The bare-name rejection is documented inline in `IconString.description`.

  **Kernel (`@skill-map/cli`) — built-in migration**

  Every built-in extractor / analyzer that declared a bare-name icon is rewritten to `pi-foo` so it passes the new pattern at load:

  - `src/built-in-plugins/extractors/stability/index.ts` — `bolt`/`ban` → `pi-bolt`/`pi-ban`
  - `src/built-in-plugins/extractors/tools-count/index.ts` — `wrench` → `pi-wrench`
  - `src/built-in-plugins/extractors/slash/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/at-directive/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/markdown-link/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/external-url-counter/index.ts` — `link` → `pi-link`
  - `src/built-in-plugins/analyzers/broken-ref/index.ts` — `times-circle` ×3 → `pi-times-circle` (manifest `alert` + `chip` + runtime payload)
  - `src/built-in-plugins/analyzers/unknown-field/index.ts` — `info-circle` ×3 → `pi-info-circle` (same shape)
  - `src/built-in-plugins/analyzers/annotation-stale/index.ts` — `clock` → `pi-clock`

  Sibling test assertions updated in lock-step (`stability.test.ts`, `tools-count.test.ts`, `broken-ref.test.ts`, `unknown-field.test.ts`, `annotation-stale.test.ts`).

  **UI — resolver + rename**

  The shared icon component is renamed and the inline resolver pulled out into a pure function:

  - `ui/src/app/slots/icon-glyph.ts` → DELETED.
  - `ui/src/app/slots/icon.ts` — new file: exports `resolveIcon(raw: string | undefined): TResolvedIcon | null` (pure, no Angular deps) and the `Icon` component (`selector: 'sm-icon'`). The resolver routes on the same prefix grammar the AJV pattern enforces (emoji / `pi-foo` / `pi pi-foo` / `fa-{family} fa-foo` / `fa-foo`); unknown shapes return `null`, which renders nothing and emits a `console.warn` naming the offending value (covers runtime corruption from a legacy persisted row or a hand-edited sidecar that bypassed the load-time AJV gate). Template emits `<span>` for emoji and `<i class="<resolved cls>">` for `pi` / `fa`; the same 1px `transform: translateY` nudge from the previous `IconGlyph` survives unchanged.
  - `ui/src/app/slots/icon.spec.ts` — new spec, 21 vitest tests over the branch matrix: empty / nullish input, emoji (single + ZWJ + ASCII punctuation), PrimeIcons shorthand + full class, FontAwesome explicit family (solid / regular / brands), FontAwesome shorthand, and rejected inputs (bare names, family-only, missing space, uppercase prefix, trim semantics). Pure function tested directly — no TestBed, because the existing TestBed setup is broken upstream of this work.
  - `ui/src/app/renderers/{node-counter,node-icon,node-alert,scope-stat}/*.ts` — import + selector update: `IconGlyph` → `Icon`, `<sm-icon-glyph>` → `<sm-icon>`. No template logic changed.

  **Why one commit**

  The spec, built-ins, and UI changes form one contract change. Splitting puts the spec ahead of the built-ins (AJV would reject every built-in manifest at load) or the UI ahead of the spec (UI would resolve shapes the spec hasn't sanctioned yet). Single commit keeps the tree green at every hash.

  **Verification**

  - `npm test` in `src/` → 1333/1333 pass (every built-in test asserts the new `pi-foo` shape).
  - `npx vitest run src/app/slots/icon.spec.ts` in `ui/` → 21/21 pass.
  - `npx tsc --noEmit -p tsconfig.app.json` in `ui/` → exit 0 (renamed selector + import wired through every renderer).
  - `npm run validate --workspace=@skill-map/spec` → spec OK, integrity OK.

  ## User-facing

  **Plugin manifest icons are now prefix-discriminated.** Use `pi-foo` (PrimeIcons), `fa-solid fa-foo` / `fa-regular fa-foo` / `fa-brands fa-foo` (FontAwesome), `fa-foo` shorthand (defaults to solid), or any emoji. Bare names like `"search"` are rejected at load.

- 4f89a84: Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

  **Two issues addressed:**

  1. **Latent bug — `POST /api/scan` ignored mid-session toggles.** `runScanForCommand` reused the BFF's boot-cached `pluginRuntime.resolveEnabled`. A user who disabled a plugin and pressed the topbar refresh saw the plugin's contributions reappear. The watcher had the same problem on every chokidar batch (it loads its own bundle once at boot).
  2. **No way to cancel.** Each toggle wrote to `config_plugins` immediately and purged `scan_contributions`. Five quick toggles meant five DB round-trips and five purges even if the net state was unchanged.

  **Approach** — four layered changes:

  - **Fresh resolver per scan.** `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions` now accept an optional `resolveEnabled` override. The BFF's `POST /api/scan` and the watcher's per-batch loop build a fresh resolver from `config_plugins` via the shared `core/runtime/fresh-resolver.ts` helper before composing extensions, so a toggle made mid-session is honoured on the next scan without restarting the server. Plugin user extensions are now filtered by the same resolver (previously only built-ins were filtered) so disabling a previously-enabled drop-in plugin actually silences it.
  - **Boot-time registries cover every built-in.** `kindRegistry` and `contributionsRegistry` (the catalogs embedded in every payload-bearing envelope) used to be seeded from the boot-time `composeScanExtensions(...)` result, which excluded any built-in that started disabled. Re-enabling such a built-in mid-session left its kinds / footer icons unrenderable because the UI's lookup tables never knew about them. Both registries now seed unconditionally from every built-in declaration (their module code is always in memory via `built-in-bundles.ts`); the enabled / disabled axis stays enforced at scan-time by the fresh resolver. Drop-in user plugins still respect boot-time filtering at the registry level — their modules weren't imported and aren't reachable mid-session (the `startsAsDisabled` exception below).
  - **Bulk endpoint `PATCH /api/plugins`.** Body `{ "changes": [{ id, enabled }, ...] }`. Validates the entire batch up-front (404 / 400 / 403 with `error.details.id` pointing at the offending entry); applies in one SQLite transaction with one grouped contributions purge. The per-id `PATCH /api/plugins/:id` and qualified-id sibling stay available for CLI / external automation.
  - **Buffered Settings modal.** Toggles mutate an in-memory `pendingState` only; rows show a dirty dot, a "N unsaved changes" banner appears above the list, and the footer exposes `[Discard] [Apply]` plus an italic warning when the dirty set re-enables a `startsAsDisabled` plugin. Closing the modal with pending edits opens a confirm dialog (`Discard` / `Keep editing` / `Apply`). Apply ships the bulk PATCH and triggers a scan via the new shared `ScanTriggerService`. A successful apply emits the panel's `applied` output, which the modal host translates into `visibleChange(false)` so the dialog closes once the work is done; a failed apply keeps the modal open with the error visible.

  **`startsAsDisabled` wire flag.** `GET /api/plugins` rows now carry `startsAsDisabled?: boolean` for drop-in plugins whose discovery-time `status === 'disabled'`. The SPA renders a per-row hint when the user re-enables such a row, since those plugins' handlers were never loaded into memory at boot and re-engaging needs an `sm serve` restart. Built-ins always omit the flag (their handlers are statically known).

  **Spec changes** (`@skill-map/spec` minor):

  - `spec/cli-contract.md` § `GET /api/plugins` — adds `startsAsDisabled?: boolean` to the item shape.
  - `spec/cli-contract.md` § `PATCH /api/plugins/:id` and the qualified-id sibling — "Restart required" is gone; replaced by an "Apply window" sentence documenting the per-scan-fresh-resolver behaviour and the `startsAsDisabled` exception.
  - `spec/cli-contract.md` § Endpoints — new `PATCH /api/plugins` row documenting the bulk endpoint (body, error mapping, transactional semantics).
  - `spec/cli-contract.md` § Error code sources — `not-found` / `bad-query` / `locked` rows updated to mention the bulk endpoint's `error.details.id` payload.
  - `spec/cli-contract.md` § `kindRegistry` envelope field — clarifies that built-in Providers are listed unconditionally regardless of boot-time enabled state, and adds a parallel `contributionsRegistry` envelope-field section with the same discipline.

  **Implementation** (`@skill-map/cli` minor):

  - `src/core/runtime/fresh-resolver.ts` — **NEW**. Shared `buildFreshResolver` + `composeResolver` helpers used by `routes/plugins.ts`, `routes/scan.ts`, and `core/watcher/runtime.ts`.
  - `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions`, `composeFormatters`, `registerEnabledExtensions` accept `resolveEnabled?`; user-plugin extensions, manifests, annotation contributions, and view contributions are filtered by the resolver.
  - `src/core/runtime/scan-runner.ts` — `IScanRunOpts.resolveEnabledOverride?` threaded into the compose call.
  - `src/server/routes/scan.ts` — builds the fresh resolver per `POST` / `?fresh=1`.
  - `src/server/routes/plugins.ts` — new `PATCH /api/plugins` bulk handler with `validateBulkChange` + `persistBulkAndProject`; `IPluginListItem` gains `startsAsDisabled`; `applyChangeToAdapter` shared between single-id and bulk paths.
  - `src/server/index.ts` — `assembleBootBundle` seeds the `kindRegistry` from every built-in Provider (new `collectBuiltInProviders` helper) and `mergeBuiltInViewContributions` now walks `builtInBundles` directly instead of the composed scan extension set, so both registries cover the full built-in surface regardless of boot-time enabled state.
  - `src/core/watcher/runtime.ts` — fresh resolver built per chokidar batch.
  - `ui/src/app/services/scan-trigger.ts` — **NEW**. Owns the manual-scan trigger (in-flight signal, `dataSource.runScan()` + `loader.load()`). Consumed by `App` and `SettingsPlugins`.
  - `ui/src/services/data-source/{port,rest-data-source,static-data-source}.ts` — new `applyPluginChanges(changes)` method.
  - `ui/src/app/components/settings-modal/settings-plugins.ts/.html/.css` — buffered state (`originalState` / `pendingState`), dirty markers, `[Discard] [Apply]` footer, per-row + footer italic `startsAsDisabled` hints, removal of the persistent "Restart required" banner, `applied` output for parent-driven close. Two-zone layout (`.settings-plugins__scroll` + footer outside the scroll container) so the footer doesn't expose scroll-through gaps.
  - `ui/src/app/components/settings-modal/settings-modal.ts/.html` — intercepts dialog close; opens `<p-confirmDialog>` with three actions when pending edits exist; bridges the panel's `applied` event to `visibleChange(false)` so footer Apply also closes.

  **Tests**:

  - `src/test/server-endpoints.test.ts` — new bulk PATCH suite (happy path, partial-failure, lock, body shape errors, `db-missing`) + a regression test asserting that `POST /api/scan` no longer re-populates a freshly-disabled plugin's contributions.

  ## User-facing

  Plugin toggles in Settings now stage edits in the modal — click Apply (or confirm at close) to commit and refresh the graph; X discards. Changes apply on the next scan, no `sm serve` restart needed (except plugins disabled at boot, marked per-row).

- b840302: Rename the view slot `card.footer.left.counter` to `card.footer.left`.

  After the `card.footer.left.tag` sub-slot was dropped (see prior CHANGELOGs), the counter became the only shape on the left footer of the card. The `.counter` suffix was a leftover of the dual-shape sub-slot scheme — the slot is now symmetrical with `card.footer.right` and consistent with the bare-base names used for `card.title.right` and `card.subtitle.left`.

  **Wire format (breaking)**

  - The `SlotName` enum in `spec/schemas/view-slots.schema.json` lists `card.footer.left` instead of `card.footer.left.counter`. The `$defs.payloads` map and the `IViewContribution.allOf` icon-required guard are updated to match.
  - Plugin manifests that declare `viewContributions[*].slot: 'card.footer.left.counter'` need to update the literal to `'card.footer.left'`. Greenfield rename: no compatibility shim, no `catalogCompat` bump (no released external plugin uses this slot).

  **Kernel + built-ins (breaking)**

  - TypeScript: `TSlotName` in `src/kernel/types/view-catalog.ts` and the `KNOWN_SLOTS` set in `src/kernel/adapters/schema-validators.ts` now use `'card.footer.left'`. The `unknown-slot` analyzer's catalog mirror is updated.
  - Built-in extractors: `at-directive`, `markdown-link`, and `slash` now declare `slot: 'card.footer.left'` in their `viewContributions.count` entry.
  - Scaffolder: the `VIEW_SLOTS_CATALOG` array and the `plugins create` stub default in `src/cli/commands/plugins.ts` emit `card.footer.left`. Help / tip text updated.

  **UI**

  - `ui/src/app/slots/slot-config.ts` — `TSlotId` and `SLOT_REGISTRY` rekeyed.
  - `ui/src/app/slots/slot-renderer-map.ts` — renderer mapping rekeyed.
  - `ui/src/app/components/node-card/node-card.html` — debug-slot data attribute and host slot literal renamed.
  - `ui/src/app/debug-slots.css` — debug-outline selector renamed.

  **Migration**

  User plugins (when any exist outside this repo) update the literal in their `plugin.json#/viewContributions[*]/slot` field. The doctor verb (`sm plugins doctor`) flags the old name as `unknown-slot` after upgrading.

  ## User-facing

  The view slot `card.footer.left.counter` was renamed to `card.footer.left` — symmetrical with `card.footer.right`. Plugin authors using the old literal in `plugin.json` need to update it; the scaffolder emits the new name automatically.

- a96c257: Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

  **Per-key locality — new `PROJECT_LOCAL_ONLY_KEYS` set**

  Four config keys are now classified as **project-local only**: `allowEditSmFiles` (new), `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Valid layers for these values are `defaults`, `user`, `user-local`, `project-local`, `override`. **The committed `project` layer (`<cwd>/.skill-map/settings.json`) is forbidden** — values found there are stripped (with a warning) at load time. `writeConfigValue(...)` with `target: 'project'` for any of the four throws `ProjectLocalOnlyKeyError`.

  Sister concept to the existing `USER_ONLY_KEYS` (still scoped to `updateCheck.enabled`):

  | Set                       | Valid layers                                                  | Forbidden layer(s)         |
  | ------------------------- | ------------------------------------------------------------- | -------------------------- |
  | `USER_ONLY_KEYS`          | `defaults`, `user`, `user-local`, `override`                  | `project`, `project-local` |
  | `PROJECT_LOCAL_ONLY_KEYS` | `defaults`, `user`, `user-local`, `project-local`, `override` | `project`                  |

  Enforcement lives in `src/kernel/config/loader.ts` (loader-side strip + warning) and `src/core/config/helper.ts` (writer-side reject). The schema stays additive — older installs that wrote one of these keys to `settings.json` keep validating; the value is silently dropped at read time and the warning surfaces via `sm config show --source`.

  **Sidecar write consent (`allowEditSmFiles`)**

  Every `.sm` write — scaffold (`sm sidecar annotate`), hash-only refresh (`sm sidecar refresh`), bump (`sm bump`, `POST /api/sidecar/bump`) — now flows through `FilesystemSidecarStore.applyPatch`, the **single chokepoint** for sidecar writes. `applyPatch` consults `allowEditSmFiles` (default `false`) via `ensureSidecarWritesAllowed` before touching disk:

  - `true` → write proceeds.
  - `false` AND caller passes `confirm: true` (CLI `--yes` / BFF `{ "confirm": true }` body) → kernel persists `allowEditSmFiles: true` to `.skill-map/settings.local.json` and performs the write.
  - `false` AND no confirm → `EConsentRequiredError`. CLI on TTY prompts via the existing `confirm()` util; CLI without TTY exits 2 with a hint; BFF returns 412 `confirm-required` with `details: { key: 'allowEditSmFiles' }` so the UI can open a `ConfirmationService` dialog.

  Decline never persists — the next attempt re-asks. The flag lives in `project-local` (gitignored) so each collaborator consents independently.

  `sm sidecar annotate` was the one writer that bypassed the store (direct `writeFileSync`); it's now refactored to route through `FilesystemSidecarStore.applyPatch` so the gate is impossible to bypass. The "exists + !force" UX check stays at the command level (preserves the legacy refusal semantics).

  **Daemon config cache (`ConfigService`)**

  New `src/core/config/service.ts` exposes a lazy, reloadable wrapper around `loadConfig()`. The Hono server instantiates one at boot and threads it through `IRouteDeps`; routes consume `deps.configService.get()` / `.effective()` instead of calling `loadConfig` per request. Mutating routes (`PATCH /api/project-preferences`, future config writers) call `.reload()` after a successful write so the next read sees the new state.

  The watcher already had its own per-batch reload pattern (`core/watcher/runtime.ts:320-326`); the daemon now shares the same principle via a single service. CLI verbs remain stateless (short-lived process; caching adds no value).

  **`project-preferences` route persistence target switched to `project-local`**

  With `scan.includeHome` / `scan.extraRoots` / `scan.referencePaths` joining `PROJECT_LOCAL_ONLY_KEYS`, the PATCH route now writes to `target: 'project-local'` (`<cwd>/.skill-map/settings.local.json`). The existing 412 `confirm-required` privacy gate (for writes that EXPAND the disk-access surface) is unchanged.

  **New spec sections**

  - `architecture.md` §IO discipline — plugins (Provider / Extractor / Analyzer / Action / Formatter / Hook) are pure: they consume context and emit data via returns or `ctx.*` callbacks. They MUST NOT write to the filesystem. All materialisation flows through kernel Ports. The consent gate at the kernel boundary is sufficient precisely because no extension has the means to write.
  - `architecture.md` §Config layering — explicit table of the six layers + the two locality sets (`USER_ONLY_KEYS`, `PROJECT_LOCAL_ONLY_KEYS`) with members and enforcement semantics.
  - `architecture.md` §Annotation system · Write consent — the consent flow normatively documented.
  - `cli-contract.md` §`.sm` write consent — describes the CLI / BFF surfaces; `cli-contract.md` §Project-local-only config — describes `sm config set` behaviour for the four keys.
  - `schemas/project-config.schema.json` — new `allowEditSmFiles` boolean (default `false`); the three privacy-sensitive scan keys' descriptions updated to flag PROJECT_LOCAL_ONLY membership and stripping behaviour.

  **Tests**

  - New: `src/test/sidecar-consent.test.ts`, `src/test/config-service.test.ts`, `ui/src/services/sidecar.spec.ts` (3 new cases), `ui/src/app/views/inspector-view/inspector-view.spec.ts` (4 new cases).
  - Extended: `src/test/config-loader.test.ts` (locality stripping), `src/test/config-helper.test.ts` (PROJECT_LOCAL_ONLY guards), `src/test/sidecar-store.test.ts` (consent gate), `src/test/bump-action.test.ts`, `src/test/bump-cli.test.ts`, `src/test/sidecar-cli.test.ts`, `src/test/server-sidecar-endpoint.test.ts`, `src/test/project-preferences-route.test.ts`.
  - `npm test` (src) — 1302 / 1302 green. `npm test -w ui` — 320 pass (3 pre-existing failures in `node-card.spec.ts` from a prior commit, unrelated).

  ## User-facing

  Skill-map asks before creating `.sm` sidecars. Pass `--yes` (CLI) or accept the dialog (UI); your consent saves to `.skill-map/settings.local.json` (gitignored). Privacy scan paths (`scan.includeHome`, etc.) no longer load from committed `settings.json`.

## 0.20.0

### Minor Changes

- a1bfe15: Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

  The previous model exposed two layers to the plugin author: a closed catalog of 11 "contracts" (`node-counter`, `node-tag`, `node-breakdown`, ...) plus an internal UI map from contract → N compatible slots. Picking a contract caused the same data to render in EVERY compatible slot (e.g. `node-counter` broadcast to four surfaces simultaneously). The 2026-05-10 collapse drops the contract layer: the plugin author picks ONE slot from a closed catalog of 14 slots; the slot fixes both the renderer and the payload shape; nothing renders implicitly. Smaller mental model, no surprise duplication, slot ids that map 1:1 to a payload.

  **Spec changes** (`@skill-map/spec`):

  - `spec/schemas/view-contracts.schema.json` renamed to `spec/schemas/view-slots.schema.json`. `$defs.ContractName` (11-entry closed enum) replaced by `$defs.SlotName` (14-entry closed enum). `$defs.IViewContribution.contract` field renamed to `slot`. `$defs.payloads` re-keyed by slot id; slots that share a payload shape (`card.subtitle.left`, `card.footer.right`, `card.footer.left.counter`, `inspector.header.badge.counter` all use the counter shape) `$ref` a shared internal definition. The conditional `allOf` discriminators that mandated `icon` on `node-counter` and `node-icon` now mandate `icon` on every counter slot and on `card.title.right`.
  - The three previously-polymorphic slots are split via dotted suffix:
    - `card.footer.left` → `card.footer.left.counter` (single sub-slot — the `card.footer.left.tag` sub-slot was considered and dropped: the counter sub-slot is multi-element, no built-in adopter wanted a tag here, and the `inspector.header.badge.tag` slot covers the remaining tag-shaped use case)
    - `inspector.header.badge` → `inspector.header.badge.counter`, `inspector.header.badge.tag`
    - `inspector.body.panel` → `inspector.body.panel.breakdown`, `.records`, `.tree`, `.key-values`, `.link-list`, `.markdown` (one per shape, narrative order in the inspector body)
  - The five monomorphic slots (`card.title.right`, `card.subtitle.left`, `card.footer.right`, `graph.node.alert`, `topbar.actions.indicator`) keep their ids unchanged.
  - `spec/view-contracts.md` renamed to `spec/view-slots.md` and rewritten as a 14-slot catalog (one section per slot: payload shape, manifest declaration, emit example, where it renders).
  - `spec/architecture.md` § View contribution system: rewritten to reflect the two-layer model. The "Plugin author NEVER picks a slot" guidance is inverted; the comparison table's "Plugin author writes" row now says "`slot` name from a closed catalog"; the "Surfaces in" row now says "fixed renderer per slot, mounted at exactly the slot the author declared".
  - `spec/plugin-author-guide.md` § View contributions: rewritten tutorial. Manifest example uses `slot:`; the slot-catalog table replaces the contract-catalog table; new "Multi-slot rendering" sub-section explains that the same data in two surfaces requires two declarations (intentional).
  - `spec/db-schema.md` § `scan_contributions`: column `contract TEXT NOT NULL` renamed to `slot TEXT NOT NULL`; comment now references `view-slots.schema.json#/$defs/SlotName`.
  - `spec/schemas/extensions/base.schema.json`, `spec/schemas/api/rest-envelope.schema.json`, `spec/schemas/plugins-registry.schema.json`: `contract` field references swept to `slot`; doc strings re-pointed at `view-slots.schema.json`. `contributionsRegistry` envelope entries now carry `slot` (not `contract`).
  - `spec/conformance/coverage.md` row 30 re-pointed at `view-slots.schema.json` and the renamed conformance case.

  **Implementation changes** (`@skill-map/cli`):

  - `src/kernel/types/view-catalog.ts`: `TContractName` (11 entries) renamed to `TSlotName` (14 entries). `IViewContribution.contract` and `IRegisteredViewContribution.contract` renamed to `slot`.
  - `src/kernel/orchestrator.ts`: extractor + rule emit paths read `declared.slot`, validate via `validateContributionPayload(declared.slot, payload)`, persist with `slot:` field. Also threads a new `freshlyRunTuples` set down through `walkAndExtract` → `runScanInternal` → caller (see Persistence-fix block below).
  - `src/kernel/adapters/schema-validators.ts`: `SUPPORTING_SCHEMAS` reads `view-slots.schema.json`. `validateContributionPayload(slot, payload)` keys validators by slot id (14 keys); error code renamed from `'unknown-contract'` to `'unknown-slot'`. The validator filters out internal `$ref` targets (`_counter`, `_tag`, `_TreeNode`) so they cannot be queried by accident.
  - `src/migrations/001_initial.sql`: `scan_contributions.contract` column renamed to `slot`. No migration script — pre-1.0 greenfield, fixtures purge on next scan.
  - `src/kernel/adapters/sqlite/contributions.ts`, `src/kernel/adapters/sqlite/schema.ts`: field rename in record types and SQL queries.
  - `src/built-in-plugins/extractors/external-url-counter/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.right'`.
  - `src/built-in-plugins/extractors/at-directive/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.left.counter'`.
  - `src/built-in-plugins/rules/link-counts/index.ts`: `linksOut.contract` → `slot: 'card.footer.right'`; `linksIn.contract` → `slot: 'card.footer.left.counter'`.
  - `src/built-in-plugins/rules/unknown-contract/` renamed (via `git mv`) to `src/built-in-plugins/rules/unknown-slot/`. Export `unknownContractRule` → `unknownSlotRule`. Internal id `'unknown-contract'` → `'unknown-slot'`. Message "declares unknown contract" → "declares unknown slot". `KNOWN_CONTRACTS` set replaced by `KNOWN_SLOTS` (14 entries).
  - `src/built-in-plugins/rules/link-counts/index.ts`: rule paused — view-contributions block stripped, `evaluate()` is now a no-op `return []`. The `linksOut` chip duplicated the per-extractor counters living next to it (`@N` from at-directive, `📎N` from markdown-link, `/N` from slash); `linksIn` was unique but kept here for symmetry. Rule remains registered (no-op) so re-enabling is a single-file change.
  - `src/built-in-plugins/extractors/markdown-link/index.ts`, `src/built-in-plugins/extractors/slash/index.ts`: gain a `card.footer.left.counter` view contribution each (`📎N` and `/N` chips), aligning with `at-directive`'s existing `@N` chip and removing the rationale for the paused `link-counts` `linksOut`.
  - `src/built-in-plugins/built-ins.ts`: import path updated.
  - `src/cli/commands/plugins.ts`: `VIEW_CONTRACTS_CATALOG` (11 entries) renamed to `VIEW_SLOTS_CATALOG` (14 entries with summaries derived from `view-slots.md`). `PluginsContractsListCommand` renamed to `PluginsSlotsListCommand`; verb path `['plugins', 'contracts', 'list']` → `['plugins', 'slots', 'list']`. `PluginsCreateCommand` scaffolder emits manifest stubs with `slot:` (default `card.footer.left.counter`); help text and tip lines now reference `sm plugins slots list`. `plugins show` qualifies extension names with `<bundleId>/<extensionId>` for `granularity=extension` so shadowed siblings stay distinguishable in the listing.
  - `src/server/contributions-registry.ts`, `src/server/routes/contributions.ts`, `src/server/envelope.ts`: registry entries and lookup items use `slot:` field.
  - `src/core/runtime/plugin-runtime.ts`: `collectViewContributions` reads `entry.slot` and pushes `slot: entry.slot as TSlotName`.
  - `context/cli-reference.md` regenerated to absorb the verb rename.

  **Persistence fix — per-tuple sweep on `scan_contributions`** (`@skill-map/cli`):

  The pre-fix persist layer ran three passes (orphan → catalog → upsert) keyed at the `(plugin, extension, node, contributionId)` level, and that wasn't enough to catch the case "extractor used to emit for node X, body change removes the trigger, prior row stays stale". A 4th pass — a per-tuple sweep keyed by `(pluginId, extensionId, nodePath)` — now drops rows whose key is absent from the current scan's contribution buffer, but ONLY for tuples that actually ran this scan.

  - `src/kernel/types/storage.ts`: `IPersistOptions` gains an optional `freshlyRunTuples?: ReadonlySet<string>` field (format `<pluginId>/<extensionId>/<nodePath>`). Empty / absent set = no per-tuple sweep (legacy callers preserve the pre-fix behaviour where stale rows linger).
  - `src/kernel/orchestrator.ts`: `walkAndExtract` accumulates a `freshlyRunTuples: Set<string>`. Extractor + cache miss → tuple INCLUDED. Extractor + cache hit → tuple OMITTED (prior rows must survive). After `applyRules`, `runScanInternal` folds in `(rule × node)` for every rule that declares `viewContributions` (rules always run and see the full graph, no per-(rule, node) cache like extractors have). The set is returned alongside `contributions` and threaded into the persist call.
  - `src/kernel/adapters/sqlite/contributions.ts` + `src/kernel/adapters/sqlite/scan-persistence.ts` + `src/kernel/adapters/sqlite/storage-adapter.ts`: persist accepts the set, runs the sweep DELETE before the upsert, scoped to keys whose `(plugin, extension, node)` is in the set but whose `(plugin, extension, node, contributionId)` is NOT in the buffer. Cached-extractor tuples remain absent from the set, so their rows are untouched.
  - `src/core/runtime/scan-runner.ts` + `src/core/watcher/runtime.ts`: thread `freshlyRunTuples` from the orchestrator return into the persist call.
  - Backwards-compat: the field is optional. The persist layer treats an absent / empty set as "skip the sweep", matching pre-fix behaviour bit-for-bit.

  **UI changes** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - `ui/src/app/contracts/contract-renderer-map.ts` renamed (via `git mv`) to `ui/src/app/slots/slot-renderer-map.ts`. The `CONTRACT_RENDERERS` + `CONTRACT_SLOTS` two-map structure is replaced by a single `SLOT_RENDERERS: Record<TSlotId, ComponentType>` (14 entries, 1:1 slot → renderer); `isKnownContract` renamed to `isKnownSlot`.
  - `ui/src/app/slots/slot-config.ts`: `TSlotId` union expanded to 14 entries; `SLOT_REGISTRY` rebuilt with sub-slots inheriting `maxItems` / `order` / `respectSeverity` from their former polymorphic parent.
  - `ui/src/app/slots/icon-glyph.ts` (new): tiny shared `<sm-icon-glyph>` component that resolves a manifest-declared `icon` per spec (`Extended_Pictographic` → emoji text; otherwise → `<i class="pi pi-{icon}">`). Adopted by `node-counter`, `node-alert`, `node-icon`, `scope-stat` — fixes the regression where `arrow-up` rendered as the literal three-character string instead of the PrimeIcons class.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts`: dispatch simplified — `contractMatchesSlot(c.contract, slot)` replaced by `c.slot === slot`; renderer lookup is `SLOT_RENDERERS[slot]`.
  - `ui/src/models/api.ts`: `IContributionApi.contract` and `IContributionsRegistryEntryApi.contract` renamed to `slot`.
  - HTML templates: the polymorphic mounts split into per-shape hosts. `node-card.html` mounts `card.footer.left.counter` (single sub-slot, no `.tag`). `inspector-view.html` mounts `inspector.header.badge.counter` + `.tag` adjacent and the six `inspector.body.panel.*` sub-slots stacked in narrative order (breakdown → records → tree → key-values → link-list → markdown). `graph-view.html`, `app.html`, and the monomorphic mounts are unchanged.
  - `ui/src/app/debug-slots.css`: 10 new entries for the sub-slots (varied hue tones for visual distinction); 3 obsolete entries removed.
  - 11 renderer components had their `IRendererInputs` import path updated to the new `slots/slot-renderer-map`; doc strings refreshed.

  **Tests**:

  - `src/test/view-contributions.test.ts`: helper interfaces and fixtures swapped to `slot:`. Validation tests now call `validateContributionPayload(<slot-id>, ...)`. Negative test "rejects unknown contract names" renamed to "rejects unknown slot names" with assertion `result.errors === 'unknown-slot'`.
  - `src/test/server-annotations-endpoint.test.ts`, `src/test/server-sidecar-endpoint.test.ts`: schema path strings updated.
  - `src/test/plugin-runtime-branches.test.ts`: rule-id list assertion updated (`'unknown-contract'` → `'unknown-slot'`).
  - `src/built-in-plugins/rules/link-counts/link-counts.test.ts`: manifest assertions reflect the new slot ids.

  **Breaking** (per the pre-1.0 minor convention — see `CONTRIBUTING.md` / `spec/versioning.md` §Pre-1.0):

  - Plugin manifests declaring `viewContributions[*].contract: 'node-counter'` (or any of the other 10 contract names) now load as `invalid-manifest`. Migration is mechanical: rename the field to `slot` and pick one of the 14 slot ids that matches the prior contract's payload shape. Recommended mapping: `node-counter` → `card.footer.right` (or another counter slot), `node-tag` → `inspector.header.badge.tag` (the only tag slot in the catalog now), `node-breakdown/records/tree/key-values/link-list/markdown` → `inspector.body.panel.<shape>`, `node-alert` → `graph.node.alert`, `node-icon` → `card.title.right`, `scope-stat` → `topbar.actions.indicator`.
  - The CLI verb `sm plugins contracts list` is removed and replaced by `sm plugins slots list`.
  - The built-in soft-warning rule `core/unknown-contract` is removed and replaced by `core/unknown-slot` (same semantics, slot-keyed walk).
  - The database column `scan_contributions.contract` is renamed to `slot`. No migration script ships — purge fixture DBs and re-run `sm scan` after upgrading. The pre-1.0 greenfield posture (no schema versioning) holds.

  ## User-facing

  **The view-contribution model is simpler.** Plugin authors now pick **one slot** from a closed catalog of 14; the slot decides where the data renders, what payload shape is expected, and which renderer draws it. The previous model required learning two catalogs (contracts and slots) and accepted that the same data would broadcast to multiple surfaces automatically — that broadcast is gone.

  Visible changes in the SPA:

  - The URL-counter chip from `core/external-url-counter` now renders only in the card's footer-right cluster (was visible in four surfaces simultaneously).
  - The `@-mention` chip from `core/at-directive`, plus new `📎` (markdown links) and `/` (slash directives) counter chips from `core/markdown-link` and `core/slash`, render only in the card's footer-left cluster.
  - The `core/link-counts` rule is paused — its `linksOut` / `linksIn` chips are temporarily off the card. `linksOut` duplicated the new per-extractor counters; `linksIn` will return when the chip surface is reinstated. The rule stays registered as a no-op so re-enabling is a single-file change.
  - The CLI verb to browse the catalog is now `sm plugins slots list` (was `sm plugins contracts list`).
  - **Stale view contributions are cleaned up.** Editing a node so an extractor stops emitting a chip (e.g. removing the last `@mention` from a doc) now removes the chip on the next scan. Previously the chip would linger until the row was clobbered by an unrelated edit.
  - Renderer icons resolve correctly across emoji and PrimeIcons names (an icon like `arrow-up` no longer leaks as the literal three-character string when the renderer expected a class name).

- 5600a60: Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

  **Spec changes** (`@skill-map/spec`):

  - `spec/schemas/extensions/hook.schema.json` — `triggers[].enum` grows from 8 to 10 entries (`boot` first, `shutdown` last). Top-level description updated to reflect the new size and the pipeline-driven vs CLI-process-driven split.
  - `spec/architecture.md` § Hook · curated trigger set — table grows by two rows. `boot` documents the pre-verb dispatch (await semantics, fire-time, payload `{ argv }`); `shutdown` documents the post-verb dispatch (await semantics, payload `{ exitCode }`). The "Eight" wording flips to "ten" in the §Hook one-liner and the §Locality count of bundled built-ins (`one Provider, four extractors, five rules, one formatter, one hook` — the first built-in hook is `core/update-check`). The `## Stability and versioning` clause updates: trigger-set size goes from 8 to 10; adding an eleventh is a minor bump, removing or renaming any of the ten is a major bump.
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`):

  - `src/kernel/extensions/hook.ts` — `THookTrigger` union and the frozen `HOOK_TRIGGERS` array grow from 8 to 10 entries (`boot` first, `shutdown` last so a debug log of the array reads in lifecycle order). Doc comment updated.
  - `src/kernel/extensions/hook-dispatcher.ts` (new) — `IHookDispatcher`, `makeHookDispatcher`, and `makeEvent` extracted from `kernel/orchestrator.ts` so two callers can share the indexing / filter / error-handling semantics: the orchestrator for the eight pipeline-driven triggers (inside `runScan`), and `cli/entry.ts` for `boot` / `shutdown`. The orchestrator now imports the helpers; the duplicated inline definitions and `matchesFilter` / `buildHookContext` helpers are gone.
  - `src/kernel/index.ts` — re-exports `makeHookDispatcher`, `makeEvent`, and `IHookDispatcher` so the CLI entry (and future drivers) can build their own dispatcher without crossing into orchestrator internals.
  - `src/built-in-plugins/hooks/update-check/index.ts` (new) — first built-in concrete `IHook`. Subscribes to `boot`, deterministic mode. Imports `maybeRunUpdateCheck` from `cli/util/update-check-banner.js` and forwards the contracted `event.data: { dbPath, cwd, homedir, stderr, noColorFlag }` payload. Defensive: a `boot` event missing any contracted field is a no-op (rather than a throw), so a misconfigured driver degrades gracefully. The lint config does not restrict `built-in-plugins/**` from importing CLI helpers (built-ins are bundled in the same binary), so the cross-layer import is intentional — `cli/util/update-check-banner.ts` is the only legal home for the env / config reads (`SM_NO_UPDATE_CHECK`, `CI`, `loadConfig`, ANSI / TTY checks) per the kernel-boundary lint rules.
  - `src/built-in-plugins/built-ins.ts` — imports `updateCheckHook` and pushes it into the `core` bundle (last entry). The `bucketBuiltIn` dispatch table already routed `kind: 'hook'` to `out.hooks`; no per-kind code change.
  - `src/cli/entry.ts` — the inline `await maybeRunUpdateCheck(...)` post-`cli.run()` block is gone. Instead: the entry now imports `builtIns()` and `makeHookDispatcher`, builds a single dispatcher over `builtIns().hooks`, dispatches `boot` BEFORE `cli.process()` (so the banner lands above the verb's output, per the Phase 3 design call), and dispatches `shutdown` AFTER `cli.run()` and BEFORE `process.exit(exitCode)`. `boot` payload carries `{ argv, dbPath, cwd, homedir, stderr, noColorFlag }`; `shutdown` payload carries `{ exitCode }`. Both dispatches await; the dispatcher catches every hook error so a buggy hook can only delay the verb / exit, never alter the resolved exit code. User-plugin hooks subscribing to `boot` / `shutdown` are loaded but not yet dispatched on this path (built-in only) — documented as a follow-up in the README.
  - `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions` "kernel-empty-boot" check no longer counts hooks. A hook subscribing only to `boot` / `shutdown` (the new CLI-driven triggers) reaches the composer through the built-in bundle but the orchestrator dispatcher would never invoke it; preserving the empty-boot shape regardless of hook presence keeps the conformance case honest while letting `core/update-check` ride along for the entry-side dispatcher to pick up.
  - `src/built-in-plugins/README.md` — adds the `core/update-check` row and a paragraph on the two dispatch entry points (orchestrator vs CLI entry) sharing the same dispatcher module.
  - `src/test/update-check-hook.test.ts` (new) — manifest-shape assertions and defensive-payload coverage for the hook (no-op when `dbPath` / `cwd` / `homedir` / `stderr` are absent; clean forward when contracted; DB missing → silent bail). Pre-existing unit + integration tests for `maybeRunUpdateCheck` (in `src/test/update-check.test.ts`) keep covering the cache + bail + banner behaviour end-to-end — the hook is a thin wrapper.
  - Two pre-existing tests updated for the new built-in count: `src/test/built-ins-modes.test.ts` (`listBuiltIns().length`: 23 → 24, comment updated to call out the new hook).

  **ROADMAP changes**:

  - §Plugin system · Hook trigger set — list grows from 8 to 10 entries; new paragraph documents the dispatcher module split (`kernel/extensions/hook-dispatcher.ts`) and points at `core/update-check` as the first built-in consumer.
  - §Glossary · Hook — one-liner updated from "one of eight" → "one of ten" with the pipeline vs CLI-process split.

  **Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (two new triggers, one new built-in hook, one new internal kernel module). No existing surface is removed or renamed; old hooks subscribing only to the eight pre-existing triggers keep working byte-for-byte. Pre-1.0 lets us land additive contract growth as `minor` without flipping to 1.0.0.

- 802e64f: Rename the `rule` plugin extension kind to `analyzer`.

  The kind formerly known as `rule` not only finds issues but also projects findings into the UI via `viewContributions` (cards, badges, tabs). "Rule" undersold the breadth of the contract; **Analyzer** captures both axes — graph analysis and visual projection. Pre-1.0, no released consumers depend on the old name, so this ships as a sweep without compatibility shims.

  **Wire format (breaking)**

  - `kind` enum in `extensions/base.schema.json` now lists `analyzer` instead of `rule`.
  - `extensions/rule.schema.json` is renamed to `extensions/analyzer.schema.json`.
  - The const value of `kind` on the kind-specific schema is `"analyzer"`.
  - The manifest array field `emitsRuleIds` is now `emitsAnalyzerIds`.

  **Issue model + REST + DB (breaking)**

  - `Issue.ruleId` is now `Issue.analyzerId` in the JSON wire and the TS shape.
  - `GET /api/issues?ruleId=<id>` becomes `GET /api/issues?analyzerId=<id>`.
  - The SQL column `scan_issues.rule_id` is now `scan_issues.analyzer_id`; the index `ix_scan_issues_rule_id` becomes `ix_scan_issues_analyzer_id`.

  **Events (breaking)**

  - The hook trigger `rule.completed` is now `analyzer.completed`. The payload field renames from `ruleId` to `analyzerId`.

  **CLI (breaking)**

  - `sm check --rules <ids>` becomes `sm check --analyzers <ids>`.
  - The conformance kill-switch env var is `SKILL_MAP_DISABLE_ALL_ANALYZERS` (was `SKILL_MAP_DISABLE_ALL_RULES`); the corresponding `conformance-case.schema.json` field is `disableAllAnalyzers`.
  - The advisory placeholder `{{ruleIds}}` in `--include-prob` output is now `{{analyzerIds}}`.

  **Kernel + built-ins (breaking)**

  - TypeScript symbols: `IRule` → `IAnalyzer`, `IRuleContext` → `IAnalyzerContext`, `IRuleOrphanSidecar` → `IAnalyzerOrphanSidecar`.
  - The 11 built-in extensions previously under `src/built-in-plugins/rules/` now live under `src/built-in-plugins/analyzers/`. Each `*Rule` symbol (e.g. `triggerCollisionRule`) is renamed to its `*Analyzer` form (`triggerCollisionAnalyzer`).
  - `IBuiltIns.rules` → `IBuiltIns.analyzers`; `IPluginRuntimeBundle.extensions.rules` → `analyzers`; `IScanExtensions.rules` → `analyzers`.
  - The kernel filter utility `kernel/util/rule-filter.ts` (`matchesRuleFilter`) is renamed to `analyzer-filter.ts` (`matchesAnalyzerFilter`).

  **Testkit (breaking, public)**

  - `runRuleOnGraph` → `runAnalyzerOnGraph`.
  - `makeRuleContext` → `makeAnalyzerContext`.
  - `IRunRuleOptions` → `IRunAnalyzerOptions`.
  - Re-exports `IAnalyzer`, `IAnalyzerContext` instead of the `IRule` variants.

  **Migration**

  Greenfield rename — no fallback. Existing user plugins with `kind: "rule"` and `emitsRuleIds` need to update their manifests. The scaffolder (`sm plugins create`) emits `kind: 'analyzer'` automatically; a future `sm plugins upgrade <id>` will rewrite legacy manifests.

  ## User-facing

  The plugin extension kind was renamed from **Rule** to **Analyzer** to better reflect what these plugins do — they analyze the graph AND project findings into the UI. End-user-visible changes:

  - The CLI flag `sm check --rules <ids>` is now `sm check --analyzers <ids>`.
  - The `sm check --json` output's per-issue `ruleId` field is now `analyzerId`.
  - Hook triggers in plugin manifests rename from `rule.completed` to `analyzer.completed`; the event payload field `ruleId` is now `analyzerId`.
  - The Settings → Plugins page lists plugins of kind "analyzer".
  - The marketing site shows the satellite as "Analyzer plugin kind" instead of "Rule plugin kind".

  If you maintain a custom plugin with `kind: "rule"`, update the manifest to `kind: "analyzer"`, rename `emitsRuleIds` to `emitsAnalyzerIds`, and rename any imported `IRule` / `IRuleContext` symbols to `IAnalyzer` / `IAnalyzerContext`. The directory name and `id` rules remain unchanged.

- 5600a60: Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

  **Spec changes** (`@skill-map/spec`, minor):

  - `spec/cli-contract.md` § Scan — `sm scan -g/--global` flag documented: with `-g` the scan walks every active Provider's `explorationDir` resolved against `~` (typically `~/.claude`, `~/.gemini`, `~/.agents`) instead of the cwd; config + DB resolve from the global scope. Mutually exclusive with positional roots (exit `2`). New §Effective roots subsection enumerates how the resolver composes `cwd` + `includeHome` + `extraRoots` + `-g`.
  - `spec/cli-contract.md` § Config — `sm config set` gains an optional `--yes` flag and a new §Privacy-sensitive config subsection: writes that EXPAND disk access outside the project (toggling `scan.includeHome` `false`→`true`, adding out-of-project paths to `scan.extraRoots` / `scan.referencePaths`) require `--yes` to confirm. Writes that NARROW the surface need no flag.
  - `spec/schemas/project-config.schema.json` — `scan` block grows three keys:
    - `includeHome: boolean` (default `false`).
    - `extraRoots: string[]` (default `[]`).
    - `referencePaths: string[]` (default `[]`).
      Every key carries a "privacy-sensitive" warning in its description so the schema-as-doc stays honest.
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`, minor):

  - `src/config/defaults.json` — three new defaults under `scan` (`includeHome: false`, `extraRoots: []`, `referencePaths: []`).
  - `src/kernel/config/loader.ts` — `IScanConfig` gains `includeHome`, `extraRoots`, `referencePaths`. Each documented inline as privacy-sensitive.
  - `src/kernel/extensions/rule.ts` — `IRuleContext` gains optional `referenceablePaths?: ReadonlySet<string>` (the side index `core/broken-ref` consults) and `cwd?: string` (absolute project root, threaded so rules can resolve relative `link.target`s without heuristics).
  - `src/kernel/orchestrator.ts` — `RunScanOptions.referenceablePaths?` and `RunScanOptions.cwd?` propagate through `runScanInternal` → `runRules` → per-rule `evaluate()`.
  - `src/core/runtime/scan-roots.ts` (new) — `resolveScanRoots({ positionalRoots, scope, cwd, homedir, providers, includeHome, extraRoots })`. Centralises the spec's § Effective roots rules: positional roots win verbatim; otherwise compose cwd + (includeHome ? HOME provider dirs : []) + extraRoots for project scope, or HOME provider dirs only for global scope. `-g` + positional roots throws.
  - `src/core/runtime/reference-paths-walker.ts` (new) — `walkReferencePaths(rawRoots, cwd, homedir)` returns `{ paths: Set<absolute>, truncated, missingRoots }`. Recursive walk that skips symlinks + `node_modules`/`.git`/`.skill-map`; capped at `REFERENCE_WALK_MAX_FILES` (50_000) for safety.
  - `src/core/runtime/scan-runner.ts` — `IScanRunOpts.scope?: 'project' | 'global'` (default `'project'`). Resolves DB via `resolveDbPath({ global: scope === 'global', ... })`, `loadConfig` honours the scope, roots resolve via `resolveScanRoots`, reference paths walk via `walkReferencePaths`, and the resolved `cwd` + `referenceablePaths` thread into `RunScanOptions`. Emits stderr advisories for HOME inclusions and reference-walk truncation / missing roots. The `runOptions` assembly extracted to a `buildRunScanOptions` helper to stay under the cyclomatic-complexity cap.
  - `src/core/runtime/i18n/scan-runner.texts.ts` — three new strings (`includingHomeAdvisory`, `includingExtraRootsAdvisory`, `referenceWalkTruncated`, `referenceWalkMissingRoot`).
  - `src/built-in-plugins/rules/broken-ref/index.ts` — refactored to consult `ctx.referenceablePaths` after the in-graph lookup misses. A path-style link target whose absolute resolution (`resolve(ctx.cwd, link.target)`) is in the side index is treated as resolved (file exists outside the indexed graph). Trigger-style links (`/foo`, `@bar`) skip the side-index lookup. The orchestrator's helper extracted to keep the rule under the complexity cap.
  - `src/cli/commands/scan.ts` — wires `-g/--global` to `runScanForCommand`'s new `scope` option. Mutex with positional roots is rejected up front with a directed message (`SCAN_TEXTS.globalWithRoots`).
  - `src/cli/commands/config.ts` — `ConfigSetCommand` gains `--yes`. When the key is in `PRIVACY_SENSITIVE_KEYS` and the new value would expand the surface, the verb prints the list of paths the change would expose and exits `2` unless `--yes` is set; with `--yes` it prints the same list as a confirmation receipt.
  - `src/cli/i18n/config.texts.ts` — `privacyGateRequired` / `privacyGateRequiredHint` / `privacyGateConfirmed`.
  - `src/cli/i18n/scan.texts.ts` — `globalWithRoots`.
  - `src/core/config/helper.ts` — adds `PRIVACY_SENSITIVE_KEYS` (a `ReadonlySet<string>`) and `projectPathExposure({ key, value, cwd, homedir })` that returns `{ expandsSurface, exposedPaths }`. Same predicate is consumed by both the CLI verb and the BFF route so the wire-side and CLI-side behaviour stay symmetric.

  **BFF additions**:

  - `src/server/routes/project-preferences.ts` (new) — `GET /api/project-preferences` returns `{ scan: { includeHome, extraRoots, referencePaths } }`; `PATCH /api/project-preferences` writes via `core/config/helper:writeConfigValue` with `target: 'project'`. Privacy-sensitive writes that expand the surface require `confirm: true` in the body — otherwise the route returns 412 `confirm-required` with the list of paths the change would expose.
  - `src/server/i18n/server.texts.ts` — eight new strings under the project-preferences section.
  - `src/server/app.ts` — registers the new route + adds `'confirm-required'` to `TErrorCode`; `codeForStatus(412)` maps to it.

  **UI additions** (private `ui/` workspace):

  - `ui/src/app/components/settings-modal/settings-project.{ts,html,css}` (new) — Project section. Renders the `includeHome` toggle plus two editable path lists (`extraRoots`, `referencePaths`) with add / remove controls. A `<p-confirmdialog>` enumerates the paths a privacy-sensitive change would expose; on accept the patch is re-issued with `confirm: true`.
  - `ui/src/app/components/settings-modal/settings-modal.{ts,html}` — `Project` added to the sidebar between `General` and `Plugins`. New `projectVisible` computed signal mirrors the General / Plugins lifecycle.
  - `ui/src/i18n/settings.texts.ts` — `sections.project` + `project: { heading, intro, includeHomeLabel, includeHomeDescription, extraRootsLabel, extraRootsDescription, extraRootsPlaceholder, referencePathsLabel, referencePathsDescription, referencePathsPlaceholder, addPathLabel, removePathLabel, confirmDialogHeader, confirmDialogIntro, confirmDialogAccept, confirmDialogReject }`.
  - `ui/src/models/api.ts` — new `IProjectPreferencesApi` and `IProjectPreferencesPatchApi` types (mirroring the BFF shape).
  - `ui/src/services/data-source/data-source.port.ts` — `IDataSourcePort` gains `getProjectPreferences()` / `setProjectPreferences(patch)`. `RestDataSource` and `StaticDataSource` implementations updated.
  - Two pre-existing test stubs (`ui/src/app/app.spec.ts`, `ui/src/app/views/graph-view/graph-view.spec.ts`) extended with the two new methods.

  **Tests**:

  - New `src/test/scan-roots.test.ts` — exhaustive coverage of `resolveScanRoots` permutations (positional verbatim, `-g` mutex throw, project / global derivations, dedup).
  - New `src/test/reference-paths-walker.test.ts` — recursive walk, missing roots, symlinks skipped, skip-list dirs, multi-root.
  - New `src/test/project-preferences-route.test.ts` — boots `createServer()` against a tempdir cwd / homedir; covers default `GET`, the `confirm-required` 412 on expansion, the `confirm: true` round-trip, and 400 body-shape errors.

  **Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (one new flag on `sm scan`, three new optional config keys, one new BFF route, one new UI section). Existing `scan` invocations behave identically with the new defaults (every new key defaults to the historical zero-state).

  ## User-facing

  **`sm scan -g` now scans your HOME directory.** Run `sm scan -g` (without positional roots) to walk every active provider's HOME dir — typically `~/.claude`, `~/.gemini`, `~/.agents` — using the global config + DB.

  **Three new privacy-sensitive project settings.** Open Settings → Project to:

  - **Include HOME provider directories** — when on, `sm scan` (without `-g`) also walks `~/.claude`, `~/.gemini`, `~/.agents` alongside your project content.
  - **Extra scan roots** — paths you can add to the scan (indexed as nodes alongside the project root).
  - **Reference paths (link validation)** — paths walked only to validate links; files there aren't indexed but `core/broken-ref` won't warn when a link target exists in one of them.

  Every change that expands disk access beyond your project root requires explicit confirmation: a confirm dialog in the UI listing the paths that will be read, or `sm config set <key> <value> --yes` on the CLI. Writes that narrow the surface (toggling off, removing paths) need no confirmation.

- 825dce4: View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

  **Spec changes** (`@skill-map/spec`):

  - New contract `node-icon` in the closed catalog (`spec/view-contracts.md`, `spec/schemas/view-contracts.schema.json`). Single icon per node — small standalone marker rendered next to the card title. Manifest requires `icon`; payload optionally overrides per-node and may add `severity` (color tint, reusing the closed `Severity` palette) and `tooltip`. No counts, no labels — for chip + number use `node-counter`; for label + severity use `node-tag`; for an alert badge on the graph node corner use `node-alert`. The schema's `allOf` discriminator gains the `node-icon` branch (mirrors the existing `node-counter` rule that requires `icon`); the `Severity` `$def` description now lists `node-icon` alongside the other severity-aware contracts.
  - New BFF error code `locked` (HTTP 403) on `PATCH /api/plugins/:id` and `PATCH /api/plugins/:bundleId/extensions/:extensionId` — emitted when the target id is in the host's hardcoded lock-list. `GET /api/plugins` mirrors the same rule by stamping an optional `locked: true` flag on the affected items so UIs can render the toggle disabled. The flag is omitted when false. Documented in `spec/cli-contract.md` (item shape, error code source table, restart-required note).

  **Implementation changes** (`@skill-map/cli`):

  - New `src/kernel/config/locked-plugins.ts` — single source of truth for the host lock-list (today: `core/markdown`). Three layers enforce it: the CLI (`sm plugins enable|disable` rejects with exit 5 + a directed message; `--all` quietly skips locked targets), the BFF (`PATCH /api/plugins/...` returns 403 `locked`), and the runtime resolver (`plugin-resolver.ts` ignores any persisted `config_plugins` row or `settings.json` entry against a locked id and returns the installed default — defense in depth so "lock" stays unbreakable regardless of stored state). Lives under `src/kernel/config/` so all three layers share the import without breaking the kernel's "no driver knows about other drivers" rule. The lock is host-only and not user-editable by design — to remove an entry, edit the file.
  - `src/server/app.ts` — `TErrorCode` gains `'locked'`; `codeForStatus` maps HTTP 403 → `locked`. `src/server/i18n/server.texts.ts` — new `pluginsLocked` / `pluginsExtensionLocked` messages. `src/server/routes/plugins.ts` — `IPluginExtensionItem` and `IPluginListItem` gain optional `locked?: boolean`; both PATCH handlers reject locked targets with HTTPException 403 before the persistence step.
  - `src/built-in-plugins/rules/unknown-contract/index.ts`, `src/kernel/types/view-catalog.ts`, `src/cli/commands/plugins.ts` (`VIEW_CONTRACTS_CATALOG`) — new `node-icon` entry registered in every catalog the kernel/CLI publishes. The `unknown-contract` lint rule now considers `node-icon` known (no warning).
  - `src/cli/commands/plugins.ts` — bundle-detail rendering now qualifies extension names with `<bundleId>/` only when `granularity: 'extension'` (the toggle-able id surface); for `granularity: 'bundle'` the per-extension names stay bare since they are informational rather than user-tippable.
  - `src/cli/i18n/plugins.texts.ts` — new `pluginLocked` / `pluginLockedHint` strings.
  - `src/test/server-endpoints.test.ts` — two new cases: PATCH against `core/markdown` returns 403 `locked`, and `GET /api/plugins` stamps `locked: true` on the same row.
  - `src/built-in-plugins/extractors/at-directive/index.ts` — gains a `node-counter` view contribution (`count` / icon `@` / label `mentions` / `emitWhenEmpty: false`) and a one-line `ctx.emitContribution('count', ...)` after the extractor's main loop. First built-in extractor to emit a real contribution end-to-end, exercising the new card slots without any user plugin installed.

  **UI changes** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - Three new slot ids in the closed UI catalog (`ui/src/app/slots/slot-config.ts`): `card.title.right` (cap 2, sits next to the node title), `card.subtitle.left` (cap 3, sits in the date stat row), `card.footer.right` (cap 5, sits alongside the hardcoded status icons in a new `.sm-gnode__footer-right-cluster` wrapper that owns the right-alignment). All three are `multi`/`priority`/`append`/`respectSeverity: true`. The card template (`ui/src/app/components/node-card/node-card.html` + `.css`) wires the three host instances; no slot is empty-collapsed (the host stays silent when no contribution targets it).
  - New `node-icon` renderer (`ui/src/app/renderers/node-icon/node-icon.ts`) — sized to match `.sm-gnode__chevron` (22×22, glyph 0.7rem) so the marker reads as a sibling of the chevron when both sit on the title row. Severity classes map to the same theme tokens the alert renderer uses.
  - The `node-counter` contract now also targets `card.footer.right` and `card.subtitle.left` (its informative slot list grows), so existing `node-counter` plugins automatically light up the new card slots without manifest changes.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts` — the `DemoContributionsService` injection and "decorate" wiring are gone (the demo service was deleted; production sources only).
  - `ui/src/app/services/demo-contributions.ts` — **deleted**. The synthetic chips-for-slot-validation service finished its purpose now that real contributions land in the new slots.
  - `ui/src/app/views/graph-view/graph-view.{html,css,ts}` — the `.sm-gnode__marker-stub` placeholder svg + its CSS stub are dropped (the host underneath is the production surface; with `node-alert` plugins now demo-ready and `node-icon` shipping, the placeholder is redundant). The `resetLayout()` confirm dialog upgrades from `window.confirm()` to PrimeNG's `<p-confirmdialog>` (header / message / typed accept-and-reject buttons; mask gets the same global blur as the public site's cookie-consent banner).
  - Settings → Plugins (`ui/src/app/components/settings-modal/settings-plugins.{ts,html,css}`) — locked rows render an amber "Locked" pill with a `pi-lock` glyph next to the existing source/version/granularity tags; the `<p-toggleswitch>` stays mounted but disabled, so the user sees the current enabled state and a tooltip explaining why it cannot move. Both bundle and extension rows participate. New helpers `bundleToggleInteractive` / `extensionToggleInteractive` gate the row-click and sub-row-click handlers.
  - `ui/src/models/api.ts` — `IPluginExtensionApi` and `IPluginItemApi` gain optional `locked?: boolean` (mirrors the BFF wire shape).
  - `ui/src/i18n/settings.texts.ts` — new `lockedLabel` / `lockedTooltip`. `ui/src/i18n/graph-view.texts.ts` — `resetLayoutConfirm` reshapes from a single string into `{ header, message, accept, reject }` to feed the PrimeNG dialog.
  - `ui/src/app/debug-slots.css` — three new debug outline colors (orange / teal / purple) for the new slots.
  - `ui/src/styles.css` — global `.p-dialog-mask` style (blur + dim) so the new `<p-confirmdialog>` and any future `<p-dialog [modal]>` get the same glass look the public site uses for its cookie-consent banner.

  **Repo plumbing**:

  - `package.json` — `bff:dev` gets a `prebff:dev` step (`npm run bff:scan`) that runs `sm scan` against `fixtures/local-scope` first, so the dev BFF always boots with a populated DB.
  - `fixtures/local-scope/` — the curated demo-content directory shrinks to a minimal `DOC1.md` + `DOC2.md` pair (slim surface for testing the new view-contribution slots and the locked-plugin behaviour). The full curated content (claude / gemini agents, skills, commands, GEMINI.md, README.md, plus the `.gitignore` / `.skillmapignore`) is preserved as `fixtures/local-scope.full/` for cases that need the kitchen-sink fixture.

  **ROADMAP changes**:

  - §UI contribution system — Slot catalog list grows from 5 to 8; Contract catalog count flips from 10 to 11 with a one-line note on `node-icon`'s niche relative to `node-alert` and `node-counter`. Last-updated marker bumped to 2026-05-10.

  **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0 — the spec change is additive (new contract entry + new optional field on the wire shape; existing `view-contracts.schema.json` consumers keep validating), the CLI change is additive (new error code, new slots, new contract, new lock surface — nothing removed), so both ride a normal minor.

  ## User-facing

  **Three new card slots and a small per-node icon contract.** The graph card now reserves room for plugin-emitted markers in three new spots: a tiny icon next to the node title (right side), a small chip in the date row, and an extra cluster on the right of the footer alongside the status icons. Existing `node-counter` plugins automatically light up the new footer-right and subtitle slots — no manifest changes needed. Plugin authors can also pick a new contract, `node-icon`, for a single-glyph marker (e.g. language flag, "has audio", platform badge) when a counter or tag would be too noisy. See [`spec/view-contracts.md`](https://github.com/crystian/skill-map/blob/main/spec/view-contracts.md#node-icon) for the full schema.

  **Plugins can now be locked by the host.** Settings → Plugins shows a "Locked" pill on plugins that the host marks as mandatory — today only `core/markdown` (the universal `.md` fallback). The toggle stays visible but disabled so it is obvious the lock is intentional, with a tooltip explaining why. `sm plugins disable core/markdown` now rejects the call with a clear message instead of writing a no-op override.

  **Reset Layout uses a proper dialog.** The "Reset all node positions" action used to fire a browser-native `confirm()` popup; it now uses the same in-app dialog style as the rest of the UI (with a destructive-styled "Reset" button and a "Cancel" escape).

### Patch Changes

- 5600a60: Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

  **Spec changes** (`@skill-map/spec`, patch):

  - `spec/schemas/project-config.schema.json` — `updateCheck` description gains a "user-scope only" note: this key SHOULD live in `~/.skill-map/settings.json`; the reference implementation forces user-scope reads via `core/config/helper:USER_ONLY_KEYS` and `sm config set` rejects writes to the project layer. Project-layer entries from older installs continue to validate but are silently ignored at read time. Schema itself stays additive (no breaking change).
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`, minor):

  - New `src/core/config/dot-path.ts` — promoted from `cli/commands/config.ts`. Exports `getAtPath` / `setAtPath` / `deleteAtPath` / `assertSafeSegments` / `enumerateConfigPaths` / `FORBIDDEN_SEGMENTS` / `ForbiddenSegmentError`. Same prototype-pollution guards as before.
  - New `src/core/config/atomic-write.ts` — promoted `writeJsonAtomic` + `readJsonObjectOrEmpty` so any settings-mutating code path shares one implementation (atomic temp-then-rename, no half-written files on crash).
  - New `src/core/config/helper.ts` — typed read / write surface composed over `loadConfig` + the promoted helpers + AJV revalidation:
    - `readConfigValue<T>(key, { scope, cwd, homedir, default?, strict? })`
    - `writeConfigValue(key, value, { target, cwd, homedir })` — AJV-revalidates the post-mutation file before atomic write
    - `removeConfigValue(key, opts)` — returns `boolean` indicating whether a write happened
    - `getValueSource(key, opts)` — wrap of `loadConfig().sources` for "who set this"
    - `USER_ONLY_KEYS` — a small set (today: `updateCheck.enabled`) the helper hard-pins to the user / global layer regardless of caller intent. Reads force `scope: 'global'`; writes throw `UserOnlyKeyError` on `target: 'project'`.
  - `src/cli/util/update-check-banner.ts` — `isUpdateCheckEnabled` now calls `readConfigValue<boolean>('updateCheck.enabled', { scope: 'global', ..., default: true })`. A project-layer override is silently ignored (the helper forces scope:'global' for the key); the previous "project wins by precedence" behavior is gone for this key only.
  - `src/cli/commands/config.ts` — refactored to use `core/config/helper` + the promoted helpers. `ConfigSetCommand` and `ConfigResetCommand` surface `UserOnlyKeyError` and `ConfigValidationError` as exit-2 errors with directed messages (`CONFIG_TEXTS.userOnlyKeyRejection` / `userOnlyKeyRejectionHint`). ~150 lines of inlined dot-path / atomic-write / forbidden-segments code deleted.
  - `src/cli/i18n/config.texts.ts` — new `userOnlyKeyRejection` / `userOnlyKeyRejectionHint` strings.

  **BFF additions** (`@skill-map/cli`):

  - New `src/server/routes/preferences.ts` — `GET /api/preferences` returns the user-scope envelope `{ updateCheck: { enabled: boolean } }`; `PATCH /api/preferences` accepts a partial patch and writes through `writeConfigValue` with `target: 'user'`. Manual body validation (no Zod, mirroring `routes/plugins.ts`); errors flow through `app.onError` as `HTTPException(400)` with the existing `bad-query` envelope code. Mounted in `src/server/app.ts`.
  - `src/server/i18n/server.texts.ts` — six new strings for the preferences route's 400 envelopes (`preferencesBodyNotJson`, `preferencesBodyNotObject`, `preferencesBodyEmpty`, `preferencesUpdateCheckNotObject`, `preferencesUpdateCheckEnabledNotBoolean`, `preferencesPersistFailed`).

  **UI additions** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - New `ui/src/app/components/settings-modal/settings-general.{ts,html,css}` — General section of the Settings modal. Today renders a single `Check for updates` toggle wired to `updateCheck.enabled`, but the component is built around a declarative `GENERAL_TOGGLES: ReadonlyArray<IGeneralToggleDef>` array — adding a future user-only preference (locale, theme, …) is one entry there plus one nested key in `SETTINGS_TEXTS.general.toggles`, no template / component change.
  - `ui/src/app/components/settings-modal/settings-modal.ts` — `general` section flips from `coming-soon` placeholder to `available`; registers `SettingsGeneral` in the imports list. The modal HTML adds the corresponding `@case ('general')` branch.
  - `ui/src/i18n/settings.texts.ts` — new `general` block with heading / intro / load-error / save-error prefixes + per-toggle label & description.
  - `ui/src/models/api.ts` — new `IPreferencesApi` and `IPreferencesPatchApi` types mirroring the BFF wire shape.
  - `ui/src/services/data-source/data-source.port.ts` — `IDataSourcePort` gains `getPreferences()` / `setPreferences(patch)`. `RestDataSource` implements them via the new BFF route; `StaticDataSource` returns the shipped default for `getPreferences()` and rejects `setPreferences()` with `code: 'demo-readonly'`.
  - Two pre-existing test stubs (`ui/src/app/app.spec.ts`, `ui/src/app/views/graph-view/graph-view.spec.ts`) extended with the two new methods so the `IDataSourcePort` mock satisfies the contract.

  **Tests**:

  - New `src/test/config-helper.test.ts` — coverage for `readConfigValue` / `writeConfigValue` / `removeConfigValue` / `getValueSource`: regular precedence, `USER_ONLY_KEYS` ignoring project layer, `UserOnlyKeyError` rejection on project-target writes, idempotent remove, schema-violation rejection (`ConfigValidationError`), prototype-pollution guard.
  - New `src/test/preferences-route.test.ts` — boots `createServer()` against a tempdir cwd / homedir; covers default `GET` envelope, `PATCH` round-trip writes to user layer (NOT project), and 400 responses for bad body / empty body / wrong type.
  - `src/test/update-check.test.ts` — extended with one case asserting a project-layer `updateCheck.enabled: false` is ignored at read time (banner still prints).

  **Pre-1.0 minor bump on `@skill-map/cli`** — the read-behavior change for `updateCheck.enabled` is observable to any user who previously wrote the key into a project file. Documented in the "user-facing" section below. The spec change is a doc-only patch (description text only; schema unchanged).

  ## User-facing

  **Update-check is now a user preference.** Whether you see "Update available" notifications no longer depends on the project you are scanning. The toggle moved to **Settings → General** in the UI; the CLI equivalent is `sm config set -g updateCheck.enabled <bool>`. `sm config set` (without `-g`) now rejects this key with a clear "rerun with -g" error so you never write it to the wrong file by accident.

  If you previously had `updateCheck.enabled: false` in `<project>/.skill-map/settings.json`, that override is now **ignored** — re-set the value with `-g` (or untick the toggle in Settings → General) to make it stick across projects.

## 0.19.0

### Minor Changes

- 3376a75: spec 0.18.0 — universal markdown fallback as a built-in Provider. The format-named generic kind `markdown` moves out of the per-vendor Provider catalogs (claude / gemini) into a dedicated built-in `core/markdown` Provider. Markdown is provider-agnostic — no vendor owns the universal `.md` format — and bundling the fallback as a regular Provider under the `core` group preserves the spec invariant that no extension is privileged. The kernel orchestrator now dedups files across the multi-Provider walk so each path is offered to AT MOST one `classify`: vendor Providers retain priority on files inside their territory, and `core/markdown` (registered LAST) picks up exactly the orphan `.md` files no vendor claimed — files at the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`, `GEMINI.md`, or anywhere else outside a known vendor path. The fallback can be disabled via `sm plugins disable core/markdown` (consistent with every other extension under `core`); orphan markdown then becomes silently invisible, matching pre-0.18.0 behaviour.

  **Spec changes** (`spec/architecture.md`): new §Provider · dispatch order and the universal markdown fallback documents the iteration contract (vendor Providers first → `core/markdown` LAST), the path-dedup invariant, and the user-disable escape hatch. `spec/db-schema.md` `Node.kind` row updated to reflect the new ownership map. `spec/conformance/cases/orphan-markdown-fallback.json` (new) locks the contract end-to-end via a multi-Provider fixture asserting that `.claude/agents/reviewer.md` lands as kind `agent` (claude) and `ARCHITECTURE.md` lands as kind `markdown` (core-markdown). `spec/conformance/coverage.md` rows 4 (`scan-result.schema.json`) and 11 (`frontmatter/base.schema.json`) flip 🟢 covered via the new case.

  **Implementation changes** (`@skill-map/cli`): new `src/built-in-plugins/providers/core-markdown/` (provider + schema). `markdown` kind removed from claude and gemini provider catalogs; their `classify` no longer returns `'markdown'` for any path. `src/kernel/orchestrator.ts` adds a per-scan `Set<path>` to dedup across the multi-Provider walk. The `core` bundle gains `coreMarkdownProvider` (granularity stays `extension` — disable-able like every other core item).

  **Breaking** (per the pre-1.0 minor convention — see CONTRIBUTING.md / `spec/versioning.md` §Pre-1.0): the `Node.provider` value for files at `notes/`, `.claude/hooks/`, `CLAUDE.md`, and arbitrary root-level `.md` files changes from `'claude'` (or `'gemini'` for `GEMINI.md`) to `'markdown'`. Downstream consumers that filtered nodes by `provider === 'claude' && kind === 'markdown'` need to query `kind === 'markdown'` only.

- f0ddae0: Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

  **Qualified-id changes**

  - `claude/frontmatter` → `core/annotations`
  - `claude/slash` → `core/slash`
  - `claude/at-directive` → `core/at-directive`

  The `claude` bundle now contains only `claudeProvider` (path classification + frontmatter parser). The Extractors moved into `core` (`granularity: 'extension'`), so each is now independently toggleable via `sm plugins disable core/<id>`. Previously these extractors lived under the `claude` bundle (`granularity: 'bundle'`) and could only be removed by disabling the whole Claude integration — the same `gemini` and `agent-skills` Provider bundles already reused them implicitly with an apologetic comment in `built-ins.ts`.

  **Why now.** The three Extractors are universal:

  - `slash` matches `/<command>` (every coding-agent platform — Claude, Gemini, Cursor, Aider — uses slash commands).
  - `at-directive` matches `@<handle>` with both GitHub-style (`@scope/name`) and namespace-style (`@ns:verb`) forms.
  - `annotations` (née `frontmatter`) reads `requires` / `related` / `supersedes` / `supersededBy` / `conflictsWith`, all defined in the skill-map spec, not in Claude's conventions; the canonical source moved to the sidecar in Step 9.6 with a transitional fallback to legacy frontmatter `metadata:`.

  Keeping them under `claude/` was deuda histórica from when Claude was the only Provider. Moving them to `core` resolves the apologetic Gemini comment and matches the architectural reality.

  **Surface changes**

  - `src/built-in-plugins/extractors/frontmatter/` → `src/built-in-plugins/extractors/annotations/`. Module export `frontmatterExtractor` → `annotationsExtractor`. `pluginId: 'claude'` → `'core'`. Docstring rewritten so the sidecar is the canonical surface and the legacy fallback is documented as transitional.
  - `src/built-in-plugins/extractors/{slash,at-directive}/index.ts` — `pluginId: 'claude'` → `'core'`.
  - `src/built-in-plugins/built-ins.ts` — three Extractors moved out of the `claude` bundle (now Provider-only) into `core`. The apologetic comment in the `gemini` bundle is gone (reuse is now structural). Top-level docstring rewritten to describe the new bundle layout.
  - `spec/architecture.md` § A.6 — namespace description updated to make `core/` the home of cross-vendor Extractors and vendor bundles strictly the Provider home.
  - `spec/plugin-author-guide.md` § Qualified extension ids — built-in inventory table reflects the new ids; § Granularity table updated to use `claude/claude` as the bundle-granularity rejection example.
  - `spec/db-schema.md` § `scan_extractor_runs` — example qualified id updated.
  - `spec/schemas/extensions/base.schema.json` — qualified-id description example updated.
  - `src/built-in-plugins/README.md` — bundle table + descriptions updated.
  - `ROADMAP.md` and `.changeset/view-contributions-system.md` — adopter mentions cross-reference the rename.
  - Tests: `src/test/built-ins-modes.test.ts`, `src/test/plugin-runtime-branches.test.ts`, `src/test/plugins-cli.test.ts`, `src/test/kernel.test.ts`, `src/built-in-plugins/extractors/extractors.test.ts`, `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/formatters/ascii/ascii.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `ui/src/app/components/linked-nodes-panel/linked-nodes-panel.spec.ts`, `ui/src/services/data-source/static-data-source.spec.ts` — qualified-id catalogue, `pluginId` assertions, fixture `sources` arrays, and the bundle-granularity rejection test all updated to the new ids and describe-block names.

  **Migration**

  - Persisted `config_plugins` rows referencing the old qualified ids (none of the moved Extractors had a useful bundle-granularity disable target, but if any user explicitly enabled / disabled `claude/<id>` it now no-ops; redo the toggle against `core/<id>`).
  - The scan caches (`scan_extractor_runs`, `node_enrichments`, `scan_contributions`) self-revalidate: rows keyed by the old qualified id `claude/<id>` quietly become orphan and are swept on the next scan; new rows land under `core/<id>`. No migration code required.

  **Out of scope.** The legacy `metadata:` frontmatter fallback inside the `annotations` Extractor stays in this bump to keep the diff to "rename + move". A follow-up bump removes it and tightens the docstring once the migration is confirmed complete across observed projects.

  **Pre-1.0 minor bump.** Per `spec/versioning.md` § Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`.

- b3ba3de: Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

  The kernel used to project those four into `Node.{title,description,stability,version}` from their canonical sources (`frontmatter.{name,description}` and `sidecar.annotations.{stability,version}`) so consumers had a single flat read surface. With the inspector slot redesign incoming and the explicit decision to read directly from the canonical surfaces, the alias became redundant: same data, two paths, one of them unnecessary indirection.

  The DB columns (`scan_nodes.{title,description,stability,version}`) stay so SQL-backed verbs (`sm list --sort-by`, faceted listings) keep their indexing fast path. The persistence layer projects the columns at write time from the canonical sources rather than from kernel-set Node fields. That keeps SQL ergonomic without polluting the API.

  **Surface changes**

  - `spec/schemas/node.schema.json` — `title` / `description` / `stability` / `version` removed from the property list. The schema's curated public shape now matches the runtime `Node` interface.
  - `src/kernel/types.ts` — `Node` interface drops the four fields. `Stability` type stays (used by extension manifests).
  - `src/kernel/orchestrator.ts` — `buildNode()` no longer populates the dropped fields; `applyAnnotationsOverlay()` removed (its only job was to set `node.{stability,version}` from the sidecar, now done at persistence-projection time).
  - `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow()` projects the four columns from `node.frontmatter` and `node.sidecar?.annotations` via three small helpers (`pickString`, `pickStability`, `pickIntegerVersion`).
  - `src/kernel/adapters/sqlite/scan-load.ts` — `rowToNode()` no longer rehydrates the four fields onto Node. Storage adapter consumers that need them read the row directly.
  - `src/cli/commands/show.ts` — `collectNodeFields()` projects render-time via a new `projectAnnotationFields(node)` helper. Trio of single-purpose pickers added (`pickNonEmptyString`, `pickStabilityFromAnnotation`, `pickIntegerVersionFromAnnotation`) keep complexity ≤ 8.
  - `src/cli/commands/export.ts`, `src/built-in-plugins/formatters/ascii/index.ts` — `pickTitle()` reads `frontmatter.name` directly.
  - `src/built-in-plugins/rules/validate-all/index.ts` — `toNodeForSchema()` projection drops the four fields (they're no longer in `node.schema.json`).
  - `ui/src/models/api.ts` — `INodeApi` drops the four fields. The unused `TStability` import is gone.
  - `ui/src/services/collection-loader.ts` — `projectNode()` no longer falls back to `api.{title,description}`; reads directly from `frontmatter.{name,description}`.

  **Tests** — fixtures and assertions across `node-enrichments.test.ts`, `render-sanitize-invariant.test.ts`, `scan-incremental.test.ts`, `server-query-adapter.test.ts`, `sidecar-reader.test.ts`, and the conformance case `sidecar-end-to-end.json` updated. The `node-enrichments` test uses the dropped fields as opaque sentinels to verify enrichment buffer mechanics; those sites cast through `unknown as Partial<Node>` with an explanatory comment — the persistence layer JSON-serialises the bag verbatim, so the round-trip works regardless of the strict Node typing.

  **Migration** — consumers that read `node.title` migrate to `node.frontmatter?.name`; same shape for `description` (`frontmatter.description`), `stability` (`sidecar.annotations.stability`), and `version` (`sidecar.annotations.version`). DB queries that filter or sort by these columns work unchanged.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 22f4439: Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

  **Why.** A "probabilistic Extractor" never actually ran during `sm scan` — it always dispatched as a job — so the dual-mode declaration was nominal, not operational. The pipeline still carried the cost: `ctx.runner` injection, the `body_hash_at_enrichment` / `stale` / `is_probabilistic` columns, the schema branch, the orchestrator's `isProb` guard. Zero Extractors with `mode: 'probabilistic'` shipped in the repo. Reducing Extractor to deterministic-only collapses an awkward dual-mode into "Extractor = pure transform over a node body; if you want LLM, write an Action".

  **Surface changes**

  - `spec/schemas/extensions/extractor.schema.json` — `mode` removed.
  - `spec/architecture.md` — capability matrix updated (Extractor → deterministic-only); `§Extractor · enrichment layer` rewritten; the stability note documents that pre-1.0 narrowing a kind from dual-mode to single-mode is permitted as a minor bump.
  - `spec/plugin-author-guide.md` — probabilistic tag-inferrer example replaced with a deterministic frontmatter-tag example; six-categories table updated; `ctx.runner` mention removed for Extractors.
  - `spec/db-schema.md` — `node_enrichments.{stale, body_hash_at_enrichment, is_probabilistic}` documented as **reserved-but-inert** (always `0` for Extractor writes); kept on the row for a future Action-issued probabilistic enrichment revision so the persistence contract does not need a migration when that revision lands.
  - `spec/cli-contract.md` — `sm refresh <node>` and `sm refresh --stale` no longer reference the prob-stub state; `--stale` is a no-op in this revision.
  - `src/kernel/extensions/extractor.ts`, `src/kernel/orchestrator.ts` — `mode` and `runner` removed; the orchestrator's enrichment record always sets `isProbabilistic: false`.
  - `src/cli/commands/refresh.ts`, `src/cli/i18n/refresh.texts.ts` — prob-skip path removed; `Persisted N enrichment row(s)` replaces `Persisted N deterministic enrichment row(s)`.
  - `src/built-in-plugins/extractors/*/index.ts` — five built-in extractors no longer declare `mode: 'deterministic'`.
  - `src/migrations/001_initial.sql`, `src/kernel/adapters/sqlite/schema.ts` — comments updated; columns retained (greenfield, no migration; the row shape is forward-compatible with the future revision).
  - `src/test/built-ins-modes.test.ts` — invariant flips: extractors must NOT declare `mode` (matching Provider / Formatter).
  - `src/test/node-enrichments.test.ts` — Test (d) removed (prob-extractor body-change → stale-flag), `buildProbEnricher` helper removed; the merge contract test (e) keeps hand-built stale rows so the helper's filter behaviour stays pinned for the future revision.

  **Pre-1.0 minor bump.** Per `spec/versioning.md` §Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`. No released consumer depended on Extractor `mode: 'probabilistic'` (zero in built-ins, fixtures, conformance, e2e); the future Action-issued enrichment revision opens a clean path for the same use case from inside the job lifecycle.

  **Out of scope (deferred to Phase B / Step 11).** How a probabilistic Action writes data persistent to a node (enrichment, sidecar, etc.). Today an Action emits a `report_json` plus an optional `TActionWrite[]` array (`{ kind: 'sidecar' }` is the only variant); the future revision will extend the discriminated union with `{ kind: 'enrichment' }` so a probabilistic Action can populate `node_enrichments` directly. That change is independent of this one and lands when the first real probabilistic Action (skill-summarizer or equivalent) needs it.

- 40d0a81: Two small wire enrichments that the new Settings modal needs:

  **`GET /api/plugins` items now carry `description?: string`** — both at the bundle level and inside each `extensions[]` entry. The bundle's value is sourced from `IBuiltInBundle.description` for built-ins (now a required field on the type — every built-in bundle declares its summary inline at `built-in-plugins/built-ins.ts`) and from `plugin.json#/description` for user plugins. Each extension entry's value comes from its own manifest's `description` per `IExtensionBase` (`extensions/base.schema.json#/properties/description`). The SPA's Settings list renders the descriptions as muted secondary text and folds them into the substring-search index alongside the ids, so authors can ship discoverable copy without needing a separate docs round-trip.

  **`GET /api/health` now carries `cwd: string` and `dbPath: string`** — both absolute. `cwd` is the project root the BFF resolves against (`runtimeContext.cwd`); `dbPath` mirrors `IServerOptions.dbPath`. The companion `db: 'present' | 'missing'` field still reports whether the file exists; the new fields tell the operator where to find it. Surfaced so the SPA's About panel can render "you are looking at <project>" plus the DB location without a second endpoint.

  Both additions are forward-compatible: existing health clients ignore the new fields, and existing plugins UI consumers tolerate the absence of `description` (it's optional on the wire).

- 40d0a81: Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

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

- 496fb72: Complete the `IAnalyzerContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

  The view-contribution surface had a half-implemented seam: any extension's manifest could declare `viewContributions`, the catalog (`kernel.getRegisteredViewContributions()`) recognised Rule declarations, but `IAnalyzerContext` had no `emitContribution` callback so a Rule's `evaluate()` had no way to actually emit. Extending `IAnalyzerContext` with `emitContribution(nodePath, contributionId, payload)` completes the seam.

  The first adopter is `core/link-counts` — a built-in Rule that emits two `node-counter` contributions per node (`linksOut`, `linksIn`) based on the post-merge graph. The data lives on `node.linksOutCount` / `node.linksInCount` already; the Rule projects it into the view contribution system so slot-aware UI surfaces (graph cards, inspector chips) render the counts uniformly with any plugin contribution. Skips emit when count is 0 to avoid empty panels.

  External URL counts (`core/external-url-counter`) keep their existing extractor-emit path; this change adds a sibling Rule, not a refactor.

  **Surface changes**

  - `src/kernel/extensions/rule.ts` — `IAnalyzerContext.emitContribution(nodePath, contributionId, payload)` added.
  - `src/kernel/orchestrator.ts` — `runRules()` builds a per-rule emission buffer with the same validator + persist semantics as the Extractor path; `RunScanOptions` adds `viewContributions?` (parallel to `annotationContributions?`). The `readDeclaredContributions` helper is generalised from `IExtractor` to any extension that carries `viewContributions` (structural typing).
  - `src/built-in-plugins/rules/link-counts/index.ts` — new built-in.
  - `src/built-in-plugins/built-ins.ts` — `linkCountsRule` registered under `core` bundle; built-in count rises from 21 to 22 (and rules from 10 to 11).
  - `spec/architecture.md` § View contribution system → Emit path — Rule-emit signature documented alongside the Extractor signature; both routed to the same `scan_contributions` rows. The reserved `emitScopeContribution` for scope-stat is noted as still pending.

  **Tests**

  - `src/built-in-plugins/rules/link-counts/link-counts.test.ts` — unit tests for the rule's evaluate logic + integration test that runs the orchestrator end-to-end and asserts the persisted contribution rows.
  - `src/test/built-ins-modes.test.ts` — total built-ins count bumped 21 → 22.
  - `src/test/plugin-runtime-branches.test.ts` — composed.rules.length asserts bumped 10 → 11; rule id list updated.
  - `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `src/test/unknown-field-rule.test.ts` — test contexts now supply a noop `emitContribution` (required field on the new `IAnalyzerContext`).

  **Persistence**: no SQL migration. The `scan_contributions` table is agnostic to the emitting kind; Rule emissions land in the same rows as Extractor emissions. The orphan sweep + catalog sweep semantics keep working unchanged.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 40d0a81: Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

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

- 68709b9: Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

  **Mental model.** A `.sm` sidecar is, conceptually, the annotations file for its `.md` node — every key under it is an annotation. The YAML root organises those annotations into structural blocks: `identity` (anchor + drift hashes), `annotations` (curated catalog), `audit` (timestamps), `settings` (reserved), and `<plugin-id>:` namespaces. The schema and docs now lead with that framing.

  **`for:` → `identity:`.** The block was always semantically about anchoring the sidecar to its node and tracking drift hashes — `for:` was concise but cryptic and got mistaken for "metadata about the node". Renamed to `identity:` everywhere: schema, parser, store, bump action, scaffold helper, fixtures, docs, UI debug panel.

  **`hidden` removed.** The curated catalog declared `annotations.hidden` for "exclude from default listings" but nothing in the runtime ever consumed it (no `--include-hidden` flag, no list filter). Dead spec surface. Dropped from the schema; the catalog now stands at **13 fields**. The matching UI rendering is gone too.

  **Surface changes**

  - `spec/schemas/sidecar.schema.json` — top-level `for` property renamed to `identity`; `required: ['for']` → `required: ['identity']`. Root description updated to lead with the "annotations file" mental model. `$defs.identity` was already named correctly; only the property reference moved.
  - `spec/schemas/annotations.schema.json` — `hidden` property removed. Description bumped from "load-bearing 14 fields" to "13 fields".
  - `spec/schemas/node.schema.json` — `Node.sidecar.root` description updated: reserved blocks list now reads `identity / annotations / settings / audit`; example sub-paths use `root.identity.*`.
  - `spec/architecture.md` — § Annotation system rewritten to lead with the mental model; identity contract uses `identity.path` / `identity.bodyHash` / `identity.frontmatterHash`. `display (hidden)` dropped from the curated-catalog enumeration.
  - `spec/cli-contract.md`, `spec/plugin-author-guide.md` — example sidecars use `identity:` blocks.
  - `spec/conformance/fixtures/**/*.sm` — three fixture sidecars updated.
  - `src/kernel/sidecar/parse.ts` — reads `root['identity']`; `IParsedSidecar` fields `forBodyHash` / `forFrontmatterHash` / `forPath` renamed to `identityBodyHash` / `identityFrontmatterHash` / `identityPath`.
  - `src/kernel/orchestrator.ts` — drift detection consumes the renamed fields.
  - `src/built-in-plugins/actions/bump/index.ts` — patch object emits `identity:` instead of `for:`.
  - `src/built-in-plugins/rules/unknown-field/index.ts` — `RESERVED_ROOT_BLOCKS` set updated.
  - `src/cli/commands/sidecar.ts` — `sm sidecar refresh` and `sm sidecar annotate` write the renamed block.
  - `ui/src/app/components/inspector-debug-panel/*` — `forBlock` / `IForBlock` renamed to `identityBlock` / `IIdentityBlock`.
  - `ui/src/app/components/annotations-panel/*` — `hidden` rendering removed (template, taxonomy section, texts catalog, spec).
  - All test fixtures (`src/test/**`, UI specs, e2e) updated to use `identity:` blocks.

  **Migration**: every `.sm` file in the wild that uses the old `for:` block is now invalid against the schema. The right fix per node:

  - Open the `.sm`.
  - Rename the top-level key from `for:` to `identity:` (no value changes).
  - Save.

  A future `sm migrate` action could automate this; for now manual edit is the path. The kernel's parser will fail closed (`invalid-sidecar` issue) on a non-renamed file, so missed migrations surface at scan time.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 9f04fc2: Tags · Phase 1 (spec only): declare the dual-source tag system.

  Skill-map's tag system is dual-source by design — author tags live in `frontmatter.tags` (in the `.md`, intrinsic categories the file's author wrote) and user tags live in `sidecar.annotations.tags` (in the `.sm`, the post-hoc tags whoever curates the project assigned). Both surfaces are first-class; searches and listings match the union, and consumers distinguish them with explicit attribution.

  This phase lands the spec changes. Persistence (`scan_node_tags` table), BFF projection (`node.tags = { byAuthor, byUser }`), CLI (`sm list --tag <name> [--tag-source author|user]`), and UI rendering follow in subsequent phases.

  **Surface changes**

  - `spec/schemas/frontmatter/base.schema.json` — `tags` declared as a universal optional field (array of non-empty strings). Per-vendor schemas extend the base via `allOf` + `$ref` so every Provider's per-kind schema accepts it without redeclaration. The intent: author tags belong in the markdown frontmatter, recognised across every vendor.
  - `spec/schemas/annotations.schema.json` — `tags` description rewritten to clarify "user-supplied" semantics, point at `frontmatter.tags` as the sibling author surface, and document the dual-source posture (search union, optional `--tag-source` filter).
  - `spec/architecture.md` § Annotation system → new "Tags · dual-source" subsection — explains the split, the persistence projection into `scan_node_tags`, the wire shape `node.tags = { byAuthor, byUser }`, and the deliberate omission from the kernel `Node` interface (consistent with the post-decision-#2 posture of "no Node-level denormalisations").
  - `spec/db-schema.md` § Table catalog → new `scan_node_tags` entry — defines the table schema (`node_path`, `tag`, `source`), the PK, the `(tag)` index for search, and the replace-all-per-scan persistence semantics. Storage estimate documented (~7.5 KB for a 50-node project with avg 3 tags/node).
  - `spec/index.json` regenerated.

  No code changes in this phase. The tag system is entirely declarative on the spec side until the next phases land the persistence + query implementation.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 89c1c17: Add an "update available" notification surface (CLI banner + UI chip).

  A passive background check now compares the running `@skill-map/cli` against the latest version published on the npm registry (`https://registry.npmjs.org/@skill-map/cli/latest`). When a newer release is available the CLI prints a one-line banner at the END of every command (after the verb's own output, on stderr), and the UI shows a chip next to the existing "Beta" badge in the topbar that opens the npm package page in a new tab.

  The check is throttled aggressively so it never feels intrusive:

  - Banner fires **at most once per 24h** — `shownAt` is persisted alongside the cached latest version.
  - Registry probe fires **at most once per 24h** — `checkedAt` drives the refresh decision; the fetch runs AFTER the verb's output with a 1500ms `AbortController` timeout, so a slow / unreachable registry never delays a command.
  - Probe + banner are skipped entirely when ANY of the following hold (cheap short-circuits, evaluated in order):
    1. `process.env.SM_NO_UPDATE_CHECK === '1'`
    2. `process.env.CI` truthy (catches GitHub Actions, GitLab, CircleCI, Travis, etc.)
    3. `process.stderr.isTTY !== true` (pipes / redirects / non-interactive shells)
    4. project DB missing (`./.skill-map/skill-map.db` not present — no scope to read from)
    5. `updateCheck.enabled === false` in the effective settings

  **Storage**

  Cache state lives in the project DB on `config_preferences` under the key `_kernel.update-check`. Value is a JSON blob `{ latestVersion, checkedAt, shownAt }`. No new table, no migration. The `_kernel.` prefix marks the row as kernel-managed (not a `sm config set` user preference). Per-project scope was an explicit decision: the cache lives wherever the verb's project DB lives; users who only run `sm -g …` against a global DB get the same behaviour scoped to that DB.

  **User opt-out**

  `spec/schemas/project-config.schema.json` gains a top-level optional block:

  ```json
  "updateCheck": {
    "enabled": false
  }
  ```

  Default is `true`. Set in either `.skill-map/settings.json` (project) or `~/.skill-map/settings.json` (user) via the existing layered loader.

  **BFF**

  New route `GET /api/update-status` returns the cached payload:

  ```json
  {
    "current": "0.18.0",
    "latest": "0.19.0",
    "isOutdated": true,
    "checkedAt": 1715212345678,
    "shownAt": 1715212345678
  }
  ```

  The route is read-only — it never triggers a probe; it reflects whatever the CLI cached on its last run. Always returns 200; missing-cache shape is `{ current, latest: null, isOutdated: false, checkedAt: null, shownAt: null }`.

  **UI**

  A new chip rendered next to the existing "Beta" stamp in the shell topbar (`ui/src/app/app.html`), gated by `updateCheck.isOutdated()`. The chip is an `<a>` to the npm package page (target `_blank`, `rel="noopener noreferrer"`), with a tooltip showing the upgrade command. Service is one-shot at boot — no polling, no dismiss button.

  **Surface changes**

  - `src/core/update-check/index.ts` — pure helpers (`fetchLatestVersion`, `compareVersions`, `isOutdated`) + types. No `process.env` reads.
  - `src/kernel/storage/update-check.ts` — Kysely-backed cache helpers against `config_preferences`.
  - `src/kernel/ports/storage.ts` — `preferences` namespace added to `StoragePort` (`loadUpdateCheckCache` / `saveUpdateCheckCache`).
  - `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the namespace into the adapter.
  - `src/cli/util/update-check-banner.ts` — `maybeRunUpdateCheck` glue. Owns every env / settings read.
  - `src/cli/i18n/update-check.texts.ts` — texts catalog for the banner (two-line block per `context/cli-output-style.md` §3.1b).
  - `src/cli/entry.ts` — post-`cli.run()` hook between the verb's exit code resolution and `process.exit`.
  - `src/server/routes/update-status.ts` — read-only BFF route.
  - `src/server/app.ts` — registers the route after `registerContributionsRoutes`.
  - `spec/schemas/project-config.schema.json` — `updateCheck.enabled` block (additive, optional).
  - `spec/index.json` — regenerated by `npm run spec`.
  - `ui/src/app/services/update-check.ts` — signal-based service; one-shot fetch.
  - `ui/src/i18n/update-check.texts.ts` — UI catalog.
  - `ui/src/models/api.ts` — `IUpdateStatusResponseApi` next to the existing BFF DTO mirrors.
  - `ui/src/app/app.ts`, `ui/src/app/app.html`, `ui/src/app/app.css` — chip wiring.

  **Tests**

  - `src/test/update-check.test.ts` — 29 tests covering semver compare, fetch (with stubbed `globalThis.fetch` + AbortError), storage round-trip, and end-to-end `maybeRunUpdateCheck` matrix (banner emits / refresh fires / each bail condition).
  - `src/test/server-update-status-endpoint.test.ts` — 2 BFF integration tests (populated cache + missing DB).
  - `ui/src/app/app.spec.ts` — 2 chip tests (rendered when outdated, absent otherwise).

  **Persistence**: no SQL migration. The `config_preferences` table is already in `001_initial.sql`.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 — schema additions are minor.

- 5624143: view contribution catalog reorg + `node-counter` narrowing + `priority` field. Pre-1.0 minor per `spec/versioning.md`; covers what would otherwise be a catalog-major bump.

  **Slot rename to `surface.location.name` pattern** — `card.chip` → `card.footer.left`, `inspector.body` → `inspector.body.panel`, `topbar.indicator` → `topbar.actions.indicator`, `graph.node.marker` → `graph.node.alert`. `inspector.header.badge` already conformed. The closed slot enum stays the same shape (5 entries) but every id now self-describes its surface and position; mounts in the UI moved to match where ambiguous (e.g. `card.footer.left` now lives inside `.sm-gnode__footer` next to the hardcoded stats, the position the new name promises).

  **Contract rename to `<scope>-<form>` pattern** — the catalog drops the `per-` prefix on per-node entries and tightens semantics on two: `per-node-counter` → `node-counter`, `per-node-tag` → `node-tag`, `per-node-breakdown` → `node-breakdown`, `per-node-records` → `node-records`, `per-node-tree` → `node-tree`, `per-node-key-values` → `node-key-values`, `per-node-link-list` → `node-link-list`, `per-node-summary` → `node-markdown` (semantic narrowing — was always the LLM-style markdown text, name now says so), `node-marker` → `node-alert`, `scope-summary` → `scope-stat`. Catalog size unchanged (still 10 contracts). `spec/view-contracts.md`, the per-contract payload schemas in `spec/schemas/view-contracts.schema.json`, the prose references in `spec/architecture.md` and `spec/plugin-author-guide.md` all renamed in lockstep.

  **`node-counter` contract narrowed** — payload is now `{ value, severity?, tooltip? }`; the inline `label` is gone (manifest `label` is metadata only — used by docs / `sm plugins doctor` and as `aria-label` for screen readers). `icon` is now REQUIRED on the manifest declaration via JSON-Schema `if/then` on `contract === 'node-counter'`. Renderers align with the host card's stat row (icon + value, no separate label line).

  **New `priority` field on `IViewContribution`** — optional number, default 100. Slots configured with `order: 'priority'` sort contributions ASC by this value with alphabetical tie-break by qualified id. Plugins use it to suggest where their contribution belongs relative to others sharing the same slot; the slot has the final say (it can keep `'alphabetical'` / `'fifo'` ordering and ignore the field). Kernel publishes the value through `IRegisteredViewContribution.priority` so the UI can pick it up at lookup time.

  **Pre-1.0 breaking note**: every plugin manifest authored against the v1 catalog needs the contract / slot ids retyped, plus `icon` if it declared a `node-counter`. `sm plugins upgrade` is the structural migration verb; no automatic rename rules are registered (the renames are mechanical search-and-replace).

- 0702381: spec 0.19.0 — view contribution system. Plugin extensions can now surface per-node typed data in the UI by picking a `contract` name from a closed kernel-published catalog (10 contracts: `per-node-counter`, `per-node-tag`, `per-node-breakdown`, `per-node-records`, `per-node-tree`, `per-node-key-values`, `per-node-link-list`, `per-node-summary`, `node-marker`, `scope-summary`) and emitting payloads at scan time via `ctx.emitContribution(id, payload)`. Plugin authors NEVER ship UI code, never write JSON Schema, and never pick UI slots — they declare intent via `viewContributions: Record<string, IViewContribution>` on each extension manifest, and the closed catalog of input-types (10 entries: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`) drives the `settings:` declarations on the plugin manifest root. New CLI verbs `sm plugins create`, `sm plugins contracts list`, `sm plugins upgrade` make scaffolding the canonical entry point.

  **Spec additions**: `spec/view-contracts.md` + `spec/input-types.md` (catalog references); `spec/schemas/view-contracts.schema.json` + `spec/schemas/input-types.schema.json` (closed-enum AJV catalogs with per-contract payload schemas); `spec/architecture.md` § View contribution system (kernel surface, persistence semantics, BFF surface, isolation rules, soft-warning rules, catalog versioning); `spec/plugin-author-guide.md` § View contributions (tutorial); `spec/db-schema.md` § `scan_contributions` (orphan + catalog sweep + upsert semantics, NOT pure replace-all). `spec/schemas/extensions/base.schema.json` extended with `viewContributions` map; `spec/schemas/plugins-registry.schema.json` extended with manifest-root `settings` + `catalogCompat` semver field + `incompatible-catalog` plugin status; `spec/schemas/api/rest-envelope.schema.json` extended with `contributionsRegistry` field on payload-bearing variants + `contributions.registered` envelope kind. `spec/schemas/extensions/extractor.schema.json` relaxes `emitsLinkKinds` minItems so pure-contributions extractors (`emitsLinkKinds: []`) load cleanly.

  **Implementation additions** (`@skill-map/cli`): kernel surface (`IExtensionBase.viewContributions`, `IExtractorCallbacks.emitContribution`, `IAnalyzerContext.viewContributions`, `kernel.{get,set}RegisteredViewContributions`); orchestrator emit-time wiring with AJV per-contract payload validation (off-contract → `extension.error` event + silent drop, mirror of `emitLink`); persistence layer (`scan_contributions` table in `src/migrations/001_initial.sql` per the migrations-consolidation greenfield fold, `src/kernel/adapters/sqlite/contributions.ts` adapter, sweep semantics in `replaceAllScanContributions`); BFF (3 endpoints under `/api/contributions/*`, `contributionsRegistry` on every payload-bearing envelope, `contributions[]` per node on `/api/scan` + `/api/nodes`); CLI verbs (`PluginsCreateCommand` scaffolder + `PluginsContractsListCommand` + `PluginsUpgradeCommand` migration shell); two built-in adopters (`core/annotations` — landed here as `claude/frontmatter` and renamed during the cross-vendor extractor move to `core/` — → `per-node-key-values`; `core/external-url-counter` → `per-node-counter`); two soft-warning rules (`core/unknown-contract`, `core/contribution-orphan`).

  **UI additions** (private `ui/` workspace): closed slot catalog (`ui/src/app/slots/slot-config.ts`) + closed renderer catalog (`ui/src/app/contracts/contract-renderer-map.ts`) + 10 renderer Angular components + slot host (`<sm-view-contributions-host>`) + contributions registry service. Mounts in inspector header badge + body + node card chip slots. Data path extensions: `IContributionApi` + `IContributionsRegistryApi`; `INodeApi.contributions[]`; `INodeView.contributions[]` (projection layer); `IDataSourcePort.lookupContribution`; rest data source ingests `contributionsRegistry` on every fetch + lazy lookup endpoint.

  **AGENTS.md** gained two new rules: "Externalized texts, not internationalized" (the project text-externalizes via per-component `*.texts.ts` catalogs, no Transloco / locale dictionaries; plugin manifests follow the same posture — `label`/`emptyText` are plain English strings, not `{ en, es }` records) and "Plugins are scaffolded, not hand-written" (`sm plugins create` is the canonical entry point, hand-writing supported but discouraged because the scaffolder catches invalid contract picks at author time vs at load).

  **Persistence semantics — important behavioral change for `scan_contributions`**: NOT pure replace-all. The watcher's cached pass leaves the buffer empty for cached nodes (no `extract()` → no `emitContribution`), so a wipe-all would drop valid prior rows on every watcher boot. The persist runs three passes inside the same transaction: (1) orphan sweep — drops rows whose `node_path` is NOT in `livePaths`; (2) catalog sweep — drops rows whose qualified id is NOT in `registeredContributionKeys`; (3) upsert — `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json` for every buffer row. Cached nodes' rows survive. Disabled-plugin rows are swept on next scan once the catalog reflects the disable. See `spec/db-schema.md` § `scan_contributions` for the full contract.

  **Breaking** (per the pre-1.0 minor convention): plugins that hand-rolled an extension manifest with `viewContributions: {...}` against a now-deprecated contract name will surface as `incompatible-catalog` and need `sm plugins upgrade <id>` (no migrations registered for catalog v1.0.0; the verb is structural). New plugin-load status `'incompatible-catalog'` joins the existing six.

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

  **Runtime contract extension.** `IAction` gains an optional `invoke<TInput, TReport>(input, ctx): IActionResult<TReport>` method (additive — actions that don't implement it keep working). `IActionResult` carries `report: TReport` plus an optional `writes?: TActionWrite[]` array; today `TActionWrite` is the discriminated union `{ kind: 'sidecar'; path; changes }`, with future write kinds (storage rows, plugin KV) landing additively. `IActionContext` introduces `{ node, nodeAbsolutePath, invoker, now }` so Actions can stamp `audit.lastBumpedBy` from a CLI-supplied `'cli'` (or `'plugin:<id>'`) value without doing any IO themselves.

  **`bump` Action behaviour matrix** (Decision #1 of the brief): stale node (or no sidecar yet) → patch increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, populates `audit.lastBumpedAt` + `lastBumpedBy` (and on first-time creation also `audit.createdAt` + `audit.createdBy`); fresh node without `force` → refusal (`{ ok: false, reason: 'fresh' }`, no writes); fresh node with `force: true` → silent no-op (`{ ok: true, noop: true }`, no writes — intended for the upcoming batch flow `sm bump --pending --staged`).

  **Spec.** `sidecar.schema.json` now formalises the `audit:` sub-shape (`lastBumpedAt` / `lastBumpedBy` / `bumpReason` / `createdAt` / `createdBy`, all optional at the property level, `additionalProperties: true`); the `bump` Action atomically fills `lastBumpedAt` + `lastBumpedBy` on every bump and `createdAt` + `createdBy` on first creation. The conformance fixture at `spec/conformance/fixtures/sidecar-example/agent-example.sm` now carries a populated audit block. New `spec/schemas/bump-report.schema.json` declares the deterministic report shape — distinct from `report-base.schema.json` which carries LLM-specific `confidence` + `safety` and is therefore wrong for deterministic Actions.

  **Greenfield + pre-1.0 versioning.** The `audit:` block formalisation is technically a breaking surface (a previously-permissive `additionalProperties: true` block now declares typed properties), but per the greenfield-no-versioning policy and the pre-1.0 versioning rule (every breaking change ships as a minor while the workspace is `0.Y.Z`), this lands as a minor on both `@skill-map/spec` and `@skill-map/cli`. No released consumer depended on the prior shape; the empty `audit: {}` documented in 9.6.2 is forward-compatible with the new declarations.

  Coverage matrix row 26 stays 🟡 partial (notes updated to mention the audit-block formalisation); row 28 lands as 🔴 missing — direct conformance case for `bump-report.schema.json` ships together with the `sm bump --json` CLI verb in Step 9.6.4. Implementation tests at `src/test/sidecar-store.test.ts` and `src/test/bump-action.test.ts` cover the runtime behaviour today.

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

  **Annotations dropped (16).** `spec/schemas/annotations.schema.json` no longer documents `provides`, `type`, `author`, `created`, `updated`, `category`, `keywords`, `icon`, `color`, `priority`, `readme`, `examplesUrl`, `github`, `homepage`, `linkedin`, `twitter`. The schema stays `additionalProperties: true`, so legacy / opaque keys still ride through; the built-in `unknown-field` rule warns on any of them as a typo. Greenfield, no migration: no released consumer depended on these in `annotations.*`.

  **Annotations kept (15).** `version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `related`, `authors`, `license`, `source`, `sourceVersion`, `released`, `tags`, `hidden`, `docsUrl`. The load-bearing versioning + supersession block is unchanged.

  **`audit.bumpReason` rolled back.** Removed from `spec/schemas/sidecar.schema.json#/$defs/audit/properties`. CLI: `--reason` flag dropped from `sm bump`; `IBumpInput.reason` removed; `buildAudit` no longer emits the field. BFF: `reason` removed from the `POST /api/sidecar/bump` JSON body schema. Tests assert the audit block surfaces `lastBumpedAt` / `lastBumpedBy` only on a bump-without-reason path. The audit block stays `additionalProperties: true` so the field can ride opaquely if a legacy sidecar carries it; the schema just doesn't curate it anymore. R6's mitigation set drops the bumpReason reference — the contract is now "bump rewrites the file; narrative goes in the `.md` body, which is never touched".

  **deepMerge null-as-delete primitive retained.** The kernel's `FilesystemSidecarStore.deepMerge` still treats a `null` patch value as a delete sentinel. No current caller after the bumpReason rollback, but the primitive is architecturally sound for future Actions that need per-write erase semantics. JSDoc updated to flag this; the unit tests stay (renamed the example field name from `bumpReason` to a neutral placeholder).

  **Fixtures + conformance.** All `.sm` files in `fixtures/local-scope/` and `fixtures/demo-scope/` trimmed to the curated set; the kitchen-sink reference fixture trimmed to 15 annotations + the load-bearing supersession block (kept the `example-plugin:` namespace). Conformance fixture `spec/conformance/fixtures/sidecar-end-to-end/agents/stale.sm` trimmed (removed `type` + `author`) so the `unknown-field` rule's expected warning count matches the case file's `issuesCount: 2` assertion. Structural sample at `spec/conformance/fixtures/sidecar-example/agent-example.sm` trimmed to the curated catalog.

  **Spec docs.** `spec/architecture.md` `## Annotation system` section: catalog list updated, `audit.bumpReason` line dropped, bump-field-set stability clause rewritten to enumerate the four current audit fields with `additionalProperties: true` documented. `spec/cli-contract.md`: `--reason` removed from the two `sm bump` rows; the worked `.sm` round-trip example trailing line replaced; `POST /api/sidecar/bump` body shape no longer carries `reason`. `spec/conformance/coverage.md` row 27 updated. `spec/index.json` regenerated.

  **ROADMAP.md.** §Step 9.6 carries a `Catalog curation 2026-05-07` note enumerating the dropped + kept sets; R6's mitigation list drops the bumpReason mention; the abridged decisions and §Frontmatter standard catalog descriptors updated.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) is a separate task delegated to app-agent later. Kernel `Node.author` denormalization stays untouched — `author` rides on `additionalProperties: true` for users who want to keep writing it informally; the read path persists the value but the field is no longer curated.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

  **Spec.** `spec/schemas/node.schema.json` no longer documents the `author` property. `spec/architecture.md` § "Read path (denormalization)" lists two columns instead of three (`stability`, `version`). `spec/db-schema.md` § scan_nodes drops the `author` row. `spec/index.json` regenerated.

  **Kernel.** `Node.author` removed from the runtime type and `IScanNodesTable.author` removed from the SQLite schema. `applyAnnotationsOverlay` no longer reads `annotations['author']`; the cache-hit reset in `runScan` no longer clears `node.author`; `buildNode` no longer initialises the field. New migration `003_drop_node_author.sql` issues `ALTER TABLE scan_nodes DROP COLUMN author;` (SQLite 3.35+ — node:sqlite ships ≥ 3.45). `scan-persistence.ts` and `scan-load.ts` no longer write or read the column.

  **CLI.** `sm show` no longer renders an `author:` row in the node header. `SHOW_TEXTS.nodeFieldAuthor` removed. The built-in `validate-all` rule's `toNodeForSchema` no longer copies `author` over to the wire shape it validates against.

  **Tests.** `sidecar-reader.test.ts`, `storage.test.ts`, `node-enrichments.test.ts`, `server-query-adapter.test.ts` updated. The fresh-sidecar fixture in `sidecar-reader.test.ts` no longer writes an `author:` annotation (rides on `additionalProperties: true` if anyone keeps writing it informally; not a denorm-source anymore).

  **Greenfield.** No automatic salvage path. Pre-9.6.2 rows had the column reset to NULL by migration 002. Anyone who later wrote `author:` in their `.sm` keeps the value verbatim under `scan_nodes.annotations_json`; the `unknown-field` rule warns on the key as a typo guard.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) remains a separate task; the UI's `INodeApi.author` optional field is not consumed by any service / view, and the BFF will simply never produce it after this change. Rip-out lands with the inspector tiering pass.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

  **Rationale.** `released` (lifecycle "officially released") was redundant with `audit.lastBumpedAt` (activity timestamp written by every `bump`) for this project's flow — the spec doesn't distinguish official release from bump, so a separate lifecycle field added confusion without unique semantics. Activity timestamp now lives exclusively in the reserved `audit:` block.

  **Spec.** `spec/schemas/annotations.schema.json` removes the `released` property; description updated to "load-bearing 14 fields" and clarifies that the activity timestamp lives in `audit.lastBumpedAt`. `spec/architecture.md` listing updated. `spec/index.json` regenerated.

  **Fixtures.** `fixtures/local-scope/.claude/agents/kitchen-sink.sm` drops the `released:` line (only fixture that carried it). Hashes unaffected — `for.bodyHash` and `for.frontmatterHash` are over the `.md`, not the `.sm`.

  **UI.** Card `daysAgo` (`ui/src/app/components/node-card/node-card.ts`) and inspector `headerDays` (`ui/src/app/views/inspector-view/inspector-view.ts`) both switch to reading `sidecar.root.audit.lastBumpedAt` — the canonical activity timestamp now flowing on the wire after R15. Annotations panel drops the `released` row from the lifecycle section (`ILifecycleSection.released` field, parsing, render, and the `texts.fields.released` strings in both `inspector-view.texts.ts` and `annotations-panel.texts.ts`).

  **Backward compatibility.** `additionalProperties: true` stays — sidecars carrying `released:` continue to validate (the field rides through as an unknown opt-in key). The built-in `unknown-field` rule will warn on it post-curation, matching the pattern for the 16 fields dropped in the 2026-05-07 catalog curation.

  Greenfield-permitted breaking surface (no released consumers depend on the prior shape) shipping as a `@skill-map/spec` minor per the pre-1.0 rule.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

  **`gemini`**

  - Walks Google's Gemini CLI on-disk conventions: `.gemini/agents/*.md` → `agent`, `.gemini/skills/<name>/SKILL.md` → `skill`, `.gemini/**/*.md` and `GEMINI.md` → `markdown` (the format-named generic fallback).
  - Per-kind frontmatter schemas absorb Google's documented contracts verbatim:
    - `agent.schema.json` — 7 vendor-specific fields (`kind: local|remote`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`) per https://geminicli.com/docs/core/subagents/. `name` + `description` come from spec base.
    - `skill.schema.json` — thin `allOf` extension of base; Google's documented Skill format requires only `name` + `description`.
    - `markdown.schema.json` — fallback, base only.
  - UI: Gemini purple + Google blue palette; `pi-sparkles` icon for agents.
  - Conformance: `basic-scan` case + `minimal-gemini` fixture (agent + skill + GEMINI.md).
  - Bundle granularity: `bundle` (the Provider is the bundle's only extension today; future Gemini-namespaced extractors land here).

  **`agent-skills`**

  - Vendor-neutral Provider that owns the open-standard path `.agents/skills/<name>/SKILL.md` jointly adopted by Anthropic, OpenAI (Codex), and Google (Gemini). Single kind: `skill`. Reclaims the path so vendor-specific Providers don't have to — the day a Codex Provider lands, the spec's `provider-ambiguous` rule fires zero times because the open-standard path already has a home.
  - UI: deliberately neutral slate (`#64748b` / `#94a3b8`) so the kind reads as "vendor-agnostic" at a glance.
  - Conformance: `basic-scan` case + `minimal-agent-skills` fixture.

  **`IProvider.classify()` returns `string | null`**

  - Old contract: `classify(path, fm): string` — must return a kind name. Old Claude returned `'markdown'` for non-`.claude/` paths; with one Provider this was fine, with multiple Providers it doubles up the same path (SQLite UNIQUE on `scan_nodes.path` violation).
  - New contract: `classify(...) → string | null`. `null` means "not my file"; the orchestrator skips it. Each Provider claims its own conventions and disclaims the rest.
  - Claude: claims `.claude/{agents,commands,skills}/`, `.claude/**/*.md` (catch-all under `.claude/`), `notes/**/*.md`, and `CLAUDE.md`. Disclaims everything else.
  - Gemini: claims `.gemini/{agents,skills}/`, `.gemini/**/*.md`, and `GEMINI.md`. Disclaims everything else.
  - agent-skills: claims `.agents/skills/<name>/SKILL.md` only.

  **Per-Provider node painting (consumer-side fix from Phase A)**

  - `node-card` now binds `[style.--accent]="providerAccent()"` so a node sourced from a non-primary Provider paints with its own Provider's color (e.g. a Gemini-sourced `agent` renders in `#9b72cb` even when Claude is the primary contributor to the `agent` kind). Primary Providers fall through to the existing `--sm-kind-<kind>` CSS var without an inline override.
  - `KindRegistryService.providersOf(kind)` returns the per-Provider sub-map; `node-card.providerAccent()` reads `entry.providers[node.provider]?.color`.

  **Conformance fixture migration**

  - All Claude conformance fixtures (`minimal-claude`, `rename-high-{before,after}`, `orphan-{before,after}`) move from project-relative `agents/` / `commands/` / `skills/` paths to `.claude/agents/` / `.claude/commands/` / `.claude/skills/` so the Claude Provider's strict `classify()` claims them.
  - `spec/conformance/fixtures/sidecar-end-to-end/agents/` → `.claude/agents/`. The matching `sidecar-end-to-end.json` case asserts the new paths.
  - `spec/conformance/cases/plugin-missing-ui-rejected.json` updated to assert all 3 built-in providers in the result (was 1).
  - `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` now declares the `markdown` kind to mirror Claude's catalog.
  - The bad-provider fixture is unchanged in intent — still rejects manifests missing `ui` — but uses the `markdown` kind to align with the Provider's current catalog.

  **Tests**

  - 8 new Gemini provider tests, 6 new agent-skills tests, 2 new node-card per-Provider painting tests. The bulk of the existing tests update to the new fixture paths; built-in modes / pluginId tests now allow the `gemini` and `agent-skills` pluginIds; the cross-provider count assertions in `plugin-runtime-branches.test.ts` (3 providers when no toggles) pick up the two new bundles.
  - Total: 1098 cli tests + 307 ui tests, all green.

  **Backward compatibility**

  Greenfield (`feedback_greenfield_no_versioning.md`): the `classify()` signature change is breaking for any plugin Provider in the wild — no released consumer holds a Provider implementation today. Stays minor pre-1.0 per `versioning.md` § Pre-1.0. Existing local DBs rescan to pick up the new kind layout (no migration ships).

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

  **Spec.** New table in `spec/db-schema.md`: `state_node_favorites(node_path PRIMARY KEY, favorited_at INTEGER NOT NULL)`. Listed in the rename heuristic's FK migration set so renaming a favorited file preserves the mark. New optional `Node.isFavorite: boolean` field in `spec/schemas/node.schema.json` — decorated by the BFF on every `/api/nodes` and `/api/nodes/:pathB64` response; consumers that don't recognise it MUST ignore it.

  **BFF.** Two new endpoints, both idempotent:

  - `PUT /api/favorites/:pathB64` — 204 on success, 404 when the path is not in the persisted scan.
  - `DELETE /api/favorites/:pathB64` — 204 always (un-favoriting an already-unmarked path is a no-op).

  The `/api/nodes` route loads the favorites set once per request via a tiny `SELECT node_path FROM state_node_favorites` query and decorates each emitted node with `isFavorite` by `Set` membership in memory — no SQL JOIN against `scan_nodes`. Cost is `O(favorites)` per request (typical projects pin a handful of nodes).

  **Storage.** New `port.favorites.{ set, unset, listPaths }` namespace on `StoragePort`. `migrateNodeFks` (rename heuristic) updates `state_node_favorites.node_path` alongside the other `state_*` tables; `findStrandedStateOrphans` scans it too. New `IMigrateNodeFksReport.nodeFavorites` counter; `sm orphans reconcile` summary line includes the count.

  **Migration `005_node_favorites.sql`** creates the table. No backfill — fresh installs and existing scopes alike start with zero favorites.

  **UI.** New `<sm-node-card>` `[isFavorite]` input + `(favoriteToggle)` output (path + new value). The graph view wires the output to `CollectionLoaderService.toggleFavorite(path, value)` which (a) flips the local store optimistically, (b) fires the BFF call, (c) rolls back on failure. The filter-bar's "Favorites only" toggle is gated by a `hasAnyFavorites` computed signal so the row stays uncluttered for first-time users; the toggle stays visible if the filter is currently active so the user can disable it after un-favoriting the last node.

  **Out of scope (deliberate).**

  - No CLI verb (`sm fav`). Favoriting is a visual / personal preference; the CLI surface stays focused on lifecycle verbs.
  - No WebSocket broadcast on favorite toggle. Multi-tab sync (`favorite.set` / `favorite.unset` events) can land later if the use case surfaces.
  - Demo (`StaticDataSource`) rejects favorite mutations with `code: 'demo-readonly'` — the optimistic flip rolls back, surfacing the read-only stance to the user.

  Tests: `src/test/favorites-storage.test.ts` (CRUD + rename heuristic + collision report — 6 cases), `src/test/server-favorites-endpoint.test.ts` (PUT/DELETE happy paths, 404, idempotency, isFavorite decoration on the list and single-node routes — 9 cases). UI: 5 new cases in `node-card.spec.ts` and 4 in `collection-loader.spec.ts`.

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

  The fallback kind classifies any markdown file under a Claude scope that does not match a more specific path (`.claude/agents/`, `.claude/commands/`, `.claude/skills/`). The previous name `note` overcommitted to a content role; the file is really just "generic markdown without a specific role". The new name reflects the _format_. Convention going forward: format-named kinds (`markdown`, future `toml`, future `json`) apply ONLY as the generic fallback. A file that IS a specific role (e.g. a Codex agent in TOML) classifies as `agent`, not `toml` — specific roles prevail over format naming.

  This rename is mechanical and pure. No behavior, validation, or persistence change beyond the kind identifier.

  **`@skill-map/spec`**

  - `schemas/extensions/provider.schema.json` description updated (the spec doesn't hardcode kind names; only prose mentions changed).
  - `schemas/node.schema.json` prose updated.
  - `schemas/summaries/note.schema.json` → `schemas/summaries/markdown.schema.json` (renamed file, `$id` updated, `title: SummaryNote` → `SummaryMarkdown`, prose updated).
  - `db-schema.md`, `README.md`, `conformance/coverage.md` — prose updates.
  - `spec/index.json` regenerated (new file path + hash, old entry removed).

  **`@skill-map/cli`**

  - `built-in-plugins/providers/claude/index.ts` — `kinds.note` → `kinds.markdown`. `defaultRefreshAction` `claude/summarize-note` → `claude/summarize-markdown`. `ui.label: 'Notes'` → `'Markdown'`. Color and icon unchanged. `classify()` fallback `'note'` → `'markdown'`.
  - `built-in-plugins/providers/claude/schemas/note.schema.json` → `markdown.schema.json` (renamed file, `$id` updated, `title: FrontmatterNote` → `FrontmatterMarkdown`).
  - `kernel/types.ts` — `NodeKind` union: `'note'` → `'markdown'`.
  - `built-in-plugins/formatters/ascii/index.ts` and `cli/commands/export.ts` — `KIND_ORDER` updated.
  - All hardcoded `'note'` test fixtures and assertions across `src/test/`, `src/built-in-plugins/`, and the Claude conformance suite (`basic-scan.json`, `coverage.md`) flipped to `'markdown'`.
  - Conformance fixture `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` (the negative-test fixture mirroring Claude shape) renamed alongside.

  **UI (`ui/`, private workspace, no version bump per AGENTS.md `ui/` policy)**

  - `models/node.ts` — `ISummaryNote` → `ISummaryMarkdown` with `kind: 'markdown'`. Union member updated.
  - `node-card.ts/.html`, `graph-layout.ts/.spec.ts`, `collection-loader.ts/.spec.ts`, `static-data-source.spec.ts`, `node-card.spec.ts`, `vendor-frontmatter.spec.ts`, `inspector-view.html` — kind literal + class binding renames.
  - CSS classes `.sm-gnode--note` → `.sm-gnode--markdown`, `.inspector__header--note` → `.inspector__header--markdown`. CSS variables `--sm-kind-note*` → `--sm-kind-markdown*` across `node-card.css`, `kind-palette.css`, `inspector-view.css`. The variables are runtime-injected from the Provider's `ui.color` value, so no static color value changed.
  - i18n comments in `i18n/node-card.texts.ts` updated.

  **Web (public site, `web/`)**

  - `app.js` color map and `STR` label map: `note` → `markdown`.
  - `index.html` demo SVG `data-type="note"` → `"markdown"`. Provider description prose dropped the legacy `hook` mention while we were there (out-of-date since spec 0.17.0; not a Phase 0 goal but cheap to fix in the same prose pass).
  - `i18n.json` key `graph.legend.note` → `graph.legend.markdown` with EN/ES values `Markdown`/`Markdown` (dev-facing audience; the technical kind name reads cleaner than the prose word "Note").

  **No data migration required.** Greenfield (per `feedback_greenfield_no_versioning.md`); existing local DBs rescan to pick up the new kind value. Historical CHANGELOG entries that reference `note` are intentionally left untouched — they document past behavior (precedent: the `.skill-mapignore` rename in spec 0.16.0).

  **Demo data.** `web/demo/data.meta.json` is a generated artifact (regenerates on next demo build); the source changes drive it.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because both `@skill-map/spec` and `@skill-map/cli` are still 0.x and no released consumer mandates the prior kind name. The first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

- c47c131: Closes review-queue item R4 (Step 9.6) — introduce a shared deterministic report base so the deterministic / probabilistic split is explicit at the schema level, symmetric with the existing `report-base.schema.json` (LLM-only `confidence` + `safety`).

  `spec/schemas/report-base-deterministic.schema.json` declares the universal shape every deterministic Action's report MUST extend: `ok` (boolean — did the Action complete its logical work?) plus action-specific keys via `additionalProperties: true`. `report-base.schema.json` (probabilistic) and `report-base-deterministic.schema.json` (deterministic) are the two endpoints of the report hierarchy; an Action's manifest `mode` field picks the side.

  `spec/schemas/bump-report.schema.json` migrates to extend the new base via `allOf` + relative `$ref` (per `context/spec.md` rule 7). The redundant inline declaration of `ok` is dropped — the base provides it. The bump-specific keys (`version`, `noop`, `reason`, `createdSidecar`) stay; `additionalProperties: true` mirrors the base so the report shape stays open across both layers.

  Coverage matrix: row 28 (`bump-report.schema.json`) notes updated to point at the new base; row 29 (`report-base-deterministic.schema.json`) lands as 🟡 partial — covered indirectly via every deterministic Action conformance case (e.g. the upcoming Step 9.6.4 `sm bump --json` case for row 28), flipping 🟢 when the first conformance case directly validates a deterministic report against this base.

  `spec/index.json` regenerated. No `@skill-map/cli` bump — the bump Action's runtime report shape (`IBumpReport` in `src/built-in-plugins/actions/bump/index.ts`) is unchanged. Greenfield + pre-1.0: breaking surface ships as a minor per the pre-1.0 versioning rule (no released consumers depended on the prior `bump-report.schema.json` shape).

- 305e75a: Step 9.6.1 — sidecar + annotation schemas. Closes the deferred portion of Decision #124 (where skill-map's own annotation fields live) by introducing two new schemas that lock the shape of the co-located YAML sidecars (`<basename>.sm`) the kernel will start reading in Step 9.6.2.

  `spec/schemas/sidecar.schema.json` declares the root shape: required `for` block (`path` + `bodyHash` + `frontmatterHash`, optional `resolvedAs` for ambiguous-classification overrides) plus reserved sibling blocks `annotations`, `settings`, `audit`. Schema is `additionalProperties: true` at every level so plugins write to their own `<plugin-id>:` namespace without coordination; the built-in `unknown-field` rule (Tier 1, always-on) warns on unrecognized root keys to catch typos.

  `spec/schemas/annotations.schema.json` lists 25 conventional annotation fields with full descriptions for editor autocomplete and IDE doc-on-hover. The load-bearing core covers versioning + supersession (`version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `provides`, `related`); provenance and lifecycle dates (`type`, `author`, `authors`, `license`, `source`, `sourceVersion`, `created`, `updated`, `released`); taxonomy (`tags`, `category`, `keywords`); display (`icon`, `color`, `priority`, `hidden`); and docs (`docsUrl`). Every field is optional; an empty `annotations: {}` is valid. `version` is a single integer monotonic counter, orthogonal to `stability` — there is no major bump concept; the convention for breaking changes is to create a new node and supersede the old.

  Conformance fixture `spec/conformance/fixtures/sidecar-example/` ships a structural sample (one `.md` + matching `.sm`); coverage matrix gains rows 26 and 27 marked 🟠 deferred — direct end-to-end conformance cases land in Step 9.6.6 alongside plugin contributions.

  This changeset is greenfield-permitted breaking surface (no released consumers depend on the prior shape) but ships as a minor per the pre-1.0 versioning policy. No code changes — Step 9.6.2 (kernel reader + drift detection) is the next sub-step. The previous "annotation home — pending decision" section in ROADMAP is rewritten to describe the sidecar shape; Decision #125 carries the formal record.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

  **Wire contract.** Method + path: `GET /api/annotations/registered`. No query params, no body, no auth (matches `/api/plugins`, `/api/config`). 200 envelope: `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. Item shape per `src/kernel/types/annotation-catalog.ts`: `{ pluginId, key, location: 'namespaced' | 'root', ownership: 'exclusive' | 'shared', schema: Record<string, unknown> }` — the inline JSON Schema as declared in the contributing plugin's manifest, not the AJV-compiled validator. Catalog is small (typically 0–50 entries) so no pagination, no filters, no caching headers; mutating the returned `items` array does not affect subsequent calls (kernel view stays frozen).

  **Composition.** `server/index.ts` now instantiates a kernel at boot (`createKernel()`), stamps `pluginRuntime.annotationContributions` onto it via `setRegisteredAnnotationKeys`, and threads the kernel through `IAppDeps.kernel` to the route factory. Routes that need the catalog read it off this kernel via closure — no shared mutable state, no DI container, factory only.

  **Refresh policy.** Same as the rest of the BFF's plugin surface — discovery happens once at `sm serve` boot. An operator that installs a new plugin restarts the server, matching the watcher's documented "loaded ONCE at boot" contract.

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection (sibling of `POST /api/sidecar/bump` from 9.6.5). The new `kind` discriminator (`annotations.registered`) is reserved at 9.6.6 and joins R7 alongside `sidecar.bumped` as the canonical `rest-envelope.schema.json#/properties/kind/enum` gap to close in one batch — same divergence stance as 9.6.5; closing the enum is part of the §Step 9.6 review-queue walk.

  Tests at `src/test/server-annotations-endpoint.test.ts`: empty catalog (real `createServer()` boot with `--no-plugins`), populated catalog with a `namespaced` + a `root + exclusive` contribution surfaced through `createApp` directly (bypasses the loader's `process.cwd()` resolution which `loadPluginRuntime` reads via `defaultRuntimeContext()`), and a mutation guard that asserts the second call still sees the original frozen view. 3 cases pass.

  UI half (autocomplete dropdown wired into the annotation editor) is post-Step-9.6 work and lands once the parent step's review queue walks to ✅.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

  **Wire contract.** Request body: `{ "nodePath": <string, required>, "force"?: <boolean>, "reason"?: <string> }`. Successful (200) envelope: `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath", "version", "status": "fresh" }, "elapsedMs": <int> }`. Refusal (409) on fresh + no force: `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. 404 on unknown `nodePath`; 400 on malformed body. Force-on-fresh is a 200 silent no-op (per the Action spec) carrying the existing version, with no on-disk change. The BFF's global `app.onError` gains a new `'sidecar-fresh'` `TErrorCode` mapped from HTTP 409.

  **WS event — `sidecar.bumped`.** After every successful 200 bump that materialises a write, the BFF broadcasts `{ "type": "sidecar.bumped", "nodePath", "version", "status": "fresh" }` over `/ws` so all connected clients refresh in lockstep. Force-on-fresh no-op responses do **not** broadcast (decision: no-op = no event — nothing changed on disk, sending the event would tell every UI to refresh state that has not moved).

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection. Two new review-queue items surfaced in `ROADMAP.md` §Step 9.6: R7 (REST envelope `kind: 'sidecar.bumped'` is not in the canonical `rest-envelope.schema.json#/properties/kind/enum` — close before flipping 9.6.5 ✅) and R8 (force-on-fresh broadcast policy — keep no-op = no event, or always broadcast on a successful 200).

  Tests at `src/test/server-sidecar-endpoint.test.ts`: 200 stale path with broadcaster receipt assertion; 409 refusal with on-disk untouched + no broadcast; 200 force-on-fresh no-op with no broadcast; 404 unknown path; 400 missing `nodePath` / wrong type / malformed JSON; round-trip parity (the on-disk `.sm` after a UI-driven bump is byte-equal to what the CLI verb would produce). 8 cases pass.

  UI half (Angular components, e2e) is the next agent's task and will flip 9.6.5 to ✅.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

  **`sm bump <node-path> [--force]`** — single-node mode. Wraps the built-in deterministic `core/bump` Action: refusal on a fresh node (`{ ok: false, reason: 'fresh' }`, exit 2) unless `--force`; with `--force` on a fresh node the verb is a silent no-op (exit 0, no stdout). On a stale or first-time node increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, stamps `audit.lastBumpedAt` + `lastBumpedBy: 'cli'` (and `audit.createdAt` + `createdBy: 'cli'` on first creation). `--json` emits the report shape declared by `bump-report.schema.json`.

  **`sm bump --pending [--staged] [--force]`** — batch mode. Walks every node whose sidecar overlay reports drift in `node.path` ASC order. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. `--staged` runs `git add <sidecar-path>` after each successful bump (failures degrade to a stderr warning, batch keeps running); preflight enforces the spec error matrix — not in a git repo (no `.git/` parent) → exit 5; `git` binary missing on PATH → exit 2.

  **`sm sidecar refresh <node-path>`** — hash-only update. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` and WITHOUT touching the audit block. Useful when a body change is editorial and the user doesn't want to spend a version increment. Distinct from the top-level `sm refresh` (enrichment-layer verb at Step A.8) — different storage, different concept; the sub-namespace prefix prevents the collision.

  **`sm sidecar prune [--dry-run]`** — delete orphan `.sm` files (sidecars whose accompanying `<basename>.md` is missing on disk). Different domain from `sm orphans` (which operates on the node graph via the rename heuristic). `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`.

  **`sm sidecar annotate <node-path> [--force]`** — pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `for:` block populated and `annotations: {}` empty, ready for editing. The `--from-frontmatter` legacy-import helper is deferred (no released consumer demands it).

  **`sm hooks install pre-commit-bump [--dry-run]`** — install (or chain into) a git pre-commit hook running `sm bump --pending --staged` so any staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the embedded skill-map marker and no-ops. When the repo already has a `pre-commit` hook, the verb appends the skill-map block rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit 5 if no `.git/` parent exists; exit 2 on write failures or unknown hook flavours.

  **Spec.** `cli-contract.md` §Actions gains a "Sidecar bump (Step 9.6.4)" subsection documenting all six verbs verbatim, the `--staged` git-error matrix, and the explicit `.sm` round-trip contract: **"`.sm` files are managed artifacts; comments and key order are not preserved on round-trip. Author commentary belongs in the markdown body or in a separate documentation file, not inside `.sm`."** R6 stays open in the Step 9.6 review queue — the UI work in 9.6.5 may force a revisit before closing the whole step.

  **Tests.** New CLI test suites at `src/test/{bump-cli,sidecar-cli,hooks-cli}.test.ts` cover the refusal / first-time-creation / batch (with real git) / staged / dry-run / chained-hook / idempotent-reinstall / scaffold paths. File-based SQLite under `.tmp/<scope>/`, never `:memory:`. CLI reference regenerated.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

  **Manifest extension.** `spec/schemas/extensions/base.schema.json` gains an optional `annotationContributions` map keyed by annotation key. Each entry declares an inline JSON Schema for the value plus two policy fields: `location` (`'namespaced'` default, `'root'` opt-in) and `ownership` (`'shared'` default, `'exclusive'` opt-in). Defaults route a contribution into the plugin's `<plugin-id>:` block at the sidecar root; `location: 'root'` lifts it to a top-level reserved key alongside `for` / `annotations` / `settings` / `audit` and REQUIRES `ownership: 'exclusive'`.

  **Loader validation.** `kernel/adapters/plugin-loader.ts` rejects two single-plugin invariants as `invalid-manifest`: `location: 'root'` with non-`exclusive` ownership, and inline `schema`s that fail to AJV-compile. After every plugin has loaded, the runtime composer (`core/runtime/plugin-runtime.ts:loadPluginRuntime`) walks the aggregated catalog and **hard-fails** when two plugins claim the same `(key, location: 'root', ownership: 'exclusive')` tuple — `loadPluginRuntime` throws a new `AnnotationContributionConflictError` and the kernel does NOT boot. Stricter than the per-plugin `invalid-manifest` path because annotation-namespace conflicts are non-recoverable: annotated `.sm` files would otherwise be non-deterministically routed.

  **Runtime catalog.** `Kernel` gains `getRegisteredAnnotationKeys(): readonly IRegisteredAnnotationKey[]`, populated once by `registerEnabledExtensions` after every plugin loads. Pure read; no side effects. Built-in catalog fields from `annotations.schema.json` are NOT included — this catalog is plugin-only. The BFF endpoint that wraps the catalog for UI autocomplete lands separately.

  **`core/unknown-field` rule.** New built-in Tier-1 typo guard (`severity: warn`). Walks parsed `.sm` sidecars and emits a warning for: (1) keys inside `annotations:` not in the curated catalog, (2) top-level keys outside the four reserved blocks that are not a registered plugin namespace nor a registered root contribution, (3) plugin-namespaced values that fail their contributing plugin's schema. The orchestrator threads parsed sidecar roots into the rule pass via `IAnalyzerContext.sidecarRoots` plus the runtime catalog via `IAnalyzerContext.annotationContributions`.

  **Conformance.** New end-to-end case `sidecar-end-to-end` with fixture `spec/conformance/fixtures/sidecar-end-to-end/`. Flips coverage rows 26 + 27 (`sidecar.schema.json` + `annotations.schema.json`) from 🟡 partial to 🟢 covered. Asserts a populated `Node.sidecar` overlay, `status: stale-*` drift, denormalised `annotations.version`, and both `annotation-stale` + `annotation-orphan` issues from the built-in core rules.

  **Side-fix.** `core/annotation-orphan` now emits `nodeIds: [<expectedMdRelative>]` instead of an empty array, closing the pre-existing `issue.schema.json#/properties/nodeIds/minItems: 1` violation latent until the conformance corpus exercised it.

  **Plugin author guide.** New section `## Annotation contributions` in `spec/plugin-author-guide.md` covers the manifest shape, namespacing default vs root opt-in, ownership rules, hard-fail collision behaviour, the Tier-1 typo guard, and the runtime catalog accessor with worked examples. The full guide rewrite for agent-first readability is deferred to a post-Step-9.6 follow-up.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

  **Storage extension.** Migration `002_sidecar_columns.sql` extends `scan_nodes` with three new columns: `sidecar_present` (INTEGER 0/1, default 0), `sidecar_status` (TEXT, NULL when absent or unparseable; one of `fresh` / `stale-body` / `stale-frontmatter` / `stale-both` otherwise), and `annotations_json` (TEXT, JSON-encoded `annotations:` block, NULL when absent or empty). The `Node` domain type gains a `sidecar` overlay that round-trips through `node.schema.json`; clients consume it as authoritative for the snapshot but never persist it across scans.

  **Breaking change — `Node.version` type flip.** The denormalised version column was a `TEXT` semver string sourced from `frontmatter.metadata.version`; it is now an `INTEGER` monotonic counter sourced from sidecar `annotations.version` (Decision #125 — single integer, orthogonal to `stability`, no major-bump concept). Pre-9.6.2 rows reset to NULL on migration — greenfield, no automatic semver→integer conversion. `node.schema.json#/properties/version` updated accordingly.

  **Source-of-truth shift for stability / version / author.** The three Node columns previously sourced from `frontmatter.metadata.*` / `frontmatter.author` now source from sidecar `annotations.{stability, version, author}`. Hard cut — the fallback through `pickMetadata` for these three fields is removed in `orchestrator.ts`. Other consumers of `metadata.*` (e.g. broken-ref's `metadata.related`) keep working; their migration lands in Step 9.6.4.

  Coverage matrix rows 26 + 27 (sidecar + annotations schemas) flip from 🟠 deferred to 🟡 partial — kernel reader is covered; full bump-end-to-end (scan → annotation queryable → drift detection → bump) still lands in Step 9.6.6. New tests under `src/test/sidecar-reader.test.ts` cover fresh / stale-body / stale-frontmatter / orphan / malformed-YAML / schema-invalid / unknown-key paths and a persistence round-trip through `scan_nodes`.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

  **Spec.** `spec/schemas/node.schema.json#/$defs/sidecarOverlay` gains an optional `root` property (`type: ['object', 'null']`, `additionalProperties: true`). It carries the entire parsed YAML payload of the matching `.sm` sidecar — every reserved block (`for`, `annotations`, `settings`, `audit`) plus any opt-in `<plugin-id>:` namespace. NULL when no sidecar accompanies the node, or when the sidecar exists but failed to parse / validate. The existing top-level `annotations` field stays — `root.annotations` duplicates it by design so pre-R15 consumers reading `sidecar.annotations` keep working unchanged. `spec/index.json` regenerated.

  **Kernel.** `ISidecarOverlay` (in `src/kernel/types.ts`) gains `root?: Record<string, unknown> | null`. The orchestrator's `resolveAndApplySidecar` site stamps `root: result.parsed.raw` (the full root that `parseSidecar()` already builds for the rule pass — no extra YAML reads). On parse failure the overlay ships `{ present: true, status: null, annotations: null, root: null }`; on absent sidecar `{ present: false }` (root absent).

  **Persistence.** Additive sibling column `scan_nodes.sidecar_root_json` (migration `004_sidecar_root_json.sql`) stores the JSON-encoded root alongside the existing `annotations_json`. Option (b) per the R15 brief — no rewrite of the existing `annotations_json` read path. `scan-persistence.ts` writes the column; `scan-load.ts` rehydrates `sidecar.root` from it.

  **BFF.** No route changes: `/api/nodes`, `/api/nodes/:pathB64`, and `/api/graph` are pass-through serializers — the new field flows through automatically once the kernel populates it.

  **UI wire model.** `ISidecarOverlayApi` (in `ui/src/models/api.ts`) gains `root?: Record<string, unknown> | null`. The internal `ISidecarOverlay` (in `ui/src/models/node.ts`) declared the field forward-compat-ready since the inspector-tiering pass; the `projectNode` mapper spreads `api.sidecar` as-is so the field propagates into `INodeView.sidecar.root` unchanged. The WS `sidecar.bumped` patcher (`CollectionLoaderService.patchSidecarFromBump`) preserves `root` across the bump-driven re-render so the inspector audit / debug / plugin-contributions panels stay populated after a bump.

  **Tests.** `src/test/sidecar-reader.test.ts`: fresh-sidecar case asserts `sidecar.root.for.{path,bodyHash}` and `sidecar.root.annotations.{stability,version}`; absent-sidecar case asserts `sidecar.root` is null/absent; persistence round-trip case adds the new `sidecar_root_json` column to the selected projection and asserts the persisted JSON rehydrates correctly. `src/test/server-endpoints.test.ts`: fixture now plants a `.sm` co-located with `architect.md` (pinned to baseline hashes for `status: fresh`); new test case `R15 — surfaces sidecar.root with the full parsed .sm payload` asserts `item.sidecar.root.for.path === target` and `item.sidecar.root.audit.lastBumpedBy === 'cli'` on the `/api/nodes/:pathB64` response.

  **Backward compatibility.** Pre-R15 consumers reading `sidecar.annotations` keep working unchanged — the field is preserved, just duplicates `root.annotations`. New consumers reading structured sub-fields (`root.for.*`, `root.audit.*`, plugin namespaces) light up automatically once their BFF / persistence layer ships this minor.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

  **R7 — REST envelope `kind` enum gap (`sidecar.bumped` + `annotations.registered`).** `spec/schemas/api/rest-envelope.schema.json` grew from four `oneOf` variants to six. `'sidecar.bumped'` (action-result variant: `value` + `elapsedMs`, no `filters` / `counts` / `kindRegistry`) covers `POST /api/sidecar/bump`. `'annotations.registered'` (catalog variant: `items` + `counts.total` only, no `filters` / `kindRegistry` / `returned`) covers `GET /api/annotations/registered`. The list variant re-imposes `counts.required: ['total', 'returned']` via per-variant override so its tally shape stays strict. `elapsedMs` is now a top-level optional integer property, present only on action-result envelopes.

  **R9 — WS event shape asymmetry.** `src/server/routes/sidecar.ts` now wraps the `sidecar.bumped` payload in the canonical `IWsEventEnvelope` shape `{ type, timestamp, data: { nodePath, version, status } }` (matches every kernel→broadcaster bridge — `scan.*`, `watcher.*`). `timestamp` serialises as an ISO 8601 string via `new Date().toISOString()`, matching the kernel orchestrator's `makeEvent`. The prior flat shape (`{ type, nodePath, version, status }`) forced the UI to accept two shapes in `isWsEvent`; that relaxation is now obsolete (the UI half lands in a follow-up `ui/` PR).

  **Tests.** `src/test/server-sidecar-endpoint.test.ts` and `src/test/server-annotations-endpoint.test.ts` each gain an AJV-compile + validate pass against `rest-envelope.schema.json` over the live 200 responses, so any future drift in the route or in the schema fails immediately. The sidecar test's broadcaster-receipt assertion now checks the canonical envelope (timestamp ISO regex, `data.{nodePath,version,status}`, no flat siblings).

  **Spec doc.** `spec/cli-contract.md` BFF subsections (`POST /api/sidecar/bump`, `GET /api/annotations/registered`) updated — both `kind` values are now part of the canonical enum, the WS event documents the wrapped envelope. `spec/index.json` regenerated.

  No new dependencies; AJV is already on the path (`Ajv2020` from `ajv/dist/2020.js`, used by the unknown-field rule). No CLI-verb surface changes.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

  Cross-provider kind sharing via a restructured `kindRegistry`: when two Providers declare the same kind name (e.g. `agent` for both Claude and a future Gemini Provider), every contribution is kept. Per-node painting can pick the matching Provider's color — the data shape supports it without forcing a kernel-side rename of every shared kind.

  **`@skill-map/spec`**

  - `extensions/provider.schema.json` — new optional `read` field. Validates `extensions: string[]` (each starting with a dot, matching `^\.[a-z0-9]+$`) and `parser: string`. Defaults at the call site (`{ extensions: ['.md'], parser: 'frontmatter-yaml' }`); not silently injected at manifest load. Precedence: when a Provider also declares the runtime `walk()` field, `walk()` wins and `read` is ignored — the runtime field is the escape hatch for non-standard discovery.
  - `api/rest-envelope.schema.json` — `kindRegistry.additionalProperties` restructured. Old shape `{ providerId, label, color, ... }` becomes `{ primaryProviderId, providers: { <providerId>: { label, color, colorDark, emoji, icon } } }`. The primary drives the kind's visible label / color / icon and the `--sm-kind-<kind>` CSS var; secondary contributors live under `providers` so per-node painting can pick the matching Provider's contribution.
  - `index.json` regenerated.

  **`@skill-map/cli` — kernel walker + parser registry**

  - New `src/kernel/scan/walk-content.ts` — `walkContent(roots, options)` async generator. Owns the audit-cleared defences (M7 symlink skip, TOCTOU stat re-check, ignore filter integration, bundled-defaults fallback) so every Provider that uses `read` inherits them.
  - New `src/kernel/scan/parsers/{types,frontmatter-yaml,plain,index}.ts` — closed registry. Built-ins: `frontmatter-yaml` (YAML frontmatter inside `--- … ---` fences, prototype-pollution-safe, `js-yaml` `JSON_SCHEMA` pinned), `plain` (entire body, empty frontmatter — for files carrying no frontmatter convention). `getParser(id)` resolves by id; `registerParser` is kernel-internal (not re-exported from `src/kernel/index.ts`) and rejects collisions with frozen built-in ids.
  - `IProvider` extended: optional `read?: IProviderReadConfig`, `walk` becomes optional. `resolveProviderWalk(provider)` returns `provider.walk` when defined, else closes over `walkContent` with `provider.read ?? defaults`. The orchestrator at `kernel/orchestrator.ts:1035` flips to `resolveProviderWalk(provider)(...)` — single-line edit.
  - `built-in-plugins/providers/claude/index.ts` migrates to declarative form. Drops `walk()`, `walkMarkdown`, `splitFrontmatter`, `FRONTMATTER_RE`, `FORBIDDEN_FRONTMATTER_KEYS`, plus the `fs/promises`, `path`, `js-yaml`, and `IIgnoreFilter` imports. Adds `read: { extensions: ['.md'], parser: 'frontmatter-yaml' }`. File shrinks from 270 to 158 lines. Behaviour identical (the audit-cleared defences live in the kernel walker / parser).
  - Tests for `frontmatter-yaml.test.ts`, `plain.test.ts`, `parsers/index.test.ts`, `walk-content.test.ts` — 28 new cases covering happy paths, malformed input, prototype-pollution strip, registry resolution + freeze semantics, M7 symlink skip, TOCTOU re-check, custom extensions, default-applied path. Existing `claude.test.ts` and `pollution-defence.test.ts` migrate to `resolveProviderWalk(claudeProvider)(...)`.

  **`@skill-map/cli` — kindRegistry refactor**

  - `src/server/kind-registry.ts` rewrites `buildKindRegistry`: per kind, first Provider in iteration order populates `primaryProviderId` and seeds `providers`; later Providers append to `providers[provider.id]` without overwriting the primary. The kernel separately surfaces `provider-ambiguous` issues for files matched by multiple Providers; the registry stays coherent during the conflict window.
  - `src/server/envelope.ts` types updated to match the wire shape (`IKindRegistryEntry` carries `primaryProviderId` + `providers`; new `IKindRegistryProviderUi` for the per-Provider sub-entry).
  - New `src/server/kind-registry.test.ts` — 4 cases covering single-provider entries, cross-provider sharing, ordering, and the empty case. The `test:ci` glob picks up `server/**/*.test.ts` going forward (was kernel + built-in-plugins + test/ only).

  **UI (`ui/`, private workspace)**

  - `models/api.ts` adds `IKindRegistryProviderUiApi` and reshapes `IKindRegistryEntryApi` to match the new wire shape.
  - `services/kind-registry.ts` — ingest now flattens the primary Provider's visuals onto the entry so existing `lookup` / `labelOf` / `colorOf` / `iconOf` keep working unchanged. New `providersOf(name)` returns the full per-Provider map for surfaces that paint per-Provider. `applyCssVars` keeps emitting `--sm-kind-<kind>` from the primary — every static CSS reference (`node-card.css`, `kind-palette.css`, `inspector-view.css`) survives without changes.
  - 3 spec files updated to construct the new wire shape in fixtures (`kind-registry.spec.ts`, `graph-view.spec.ts`, `list-view.spec.ts`, `filter-url-sync.spec.ts`); `kind-registry.spec.ts` adds 2 new cases for cross-provider sharing and CSS-var derivation.

  **Demo dataset (`web/scripts/build-demo-dataset.js`)**

  - The hardcoded `DEMO_KIND_REGISTRY` is updated to the new shape and regenerated as part of `web:build`. The legacy `hook` entry (already obsolete since spec 0.17.0) is dropped to keep the demo aligned with the active built-in catalog.

  **Known limitation (deferred to Phase B).** With shared kind names possible, a node sourced from a non-primary Provider currently renders in the primary's color — the data shape (`entry.providers[node.provider]`) supports per-Provider painting, but the consumer-side fix (node-card / inspector reading `node.provider` to pick the matching color) ships in Phase B alongside the new Providers, when shared kind names are actually produced. During this release window no Provider produces shared kind names, so the tradeoff has zero user-visible impact.

  **Backward compatibility.** Greenfield (`feedback_greenfield_no_versioning.md`): no released consumer holds the prior `kindRegistry` shape or relies on a Provider's hand-rolled `walk()`. Stays minor pre-1.0 per `versioning.md` § Pre-1.0.

## 0.17.0

### Minor Changes

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

  The root `npm run sqlite` shortcut now invokes the project-built CLI binary (`node src/bin/sm.js db browser`) instead of the standalone script. This guarantees the locally compiled CLI is used, not whichever `sm` resolves on PATH (a globally installed `@skill-map/cli` would otherwise shadow the in-development version).

  Spec: `cli-contract.md` documents the new sub-command in the verb table and the §Database section.

- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

  Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). Combining `--no-ui` with the default `--open` emits a non-fatal stderr warning suggesting `--no-open` (the auto-opened tab would land on the placeholder rather than the live UI). `/api/*` and `/ws` remain fully functional; only the static SPA is suppressed.

  Spec impact: `spec/cli-contract.md` documents the new flag in the `sm serve` signature and the §Server flags table, including the mutual-exclusion + warning rules.

- bd5e360: Trim `frontmatter/base.schema.json` to the truly universal contract: `name` + `description` are the only required fields, every node on every Provider, and `additionalProperties: true` lets vendor-specific keys flow through silently.

  The previous base inadvertently curated a Claude-flavored shape (`tools`, `allowedTools`, full `metadata` block with `version` required, etc.). skill-map AGGREGATES vendor specs, it does not curate them — so per-vendor frontmatter shapes belong in the Provider that emits the kind. The Anthropic-specific catalog now lives entirely under `src/built-in-plugins/providers/claude/schemas/` and absorbs Anthropic's documented frontmatter verbatim (see the matching `@skill-map/cli` changeset).

  The future home for skill-map-only annotation fields (provenance, cross-vendor metadata, source URL, supersedes/supersededBy) is a deferred decision — sidecar file vs in-frontmatter block — tracked separately. Existing files that carry `metadata: { version, ... }` continue to validate without any change because of `additionalProperties: true`; nothing breaks at the consumer edge.

  Decision #55 (full metadata block in the universal base) is superseded by this change.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/spec` is still 0.x and Decision #55 had not reached any released consumer that mandates the prior shape. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

  Rationale: drop the dash for consistency with `.gitignore` / `.npmignore` / `.dockerignore` and friends — those tools use a contiguous lowercase token, and adopting the same shape removes the visual stutter when listing dotfiles. The rename also avoids confusion between the public artifact and the package id `@skill-map/*` which uses a dash by convention.

  Breaking change pre-1.0:

  - `sm init` now scaffolds `.skillmapignore` instead of `.skill-mapignore`. Existing projects must `mv .skill-mapignore .skillmapignore` manually — no compat reader (greenfield rule, see `feedback_greenfield_no_versioning.md`).
  - The bundled defaults asset moved from `src/config/defaults/skill-mapignore` to `src/config/defaults/skillmapignore`.
  - `sm serve` and `sm watch` now watch `.skillmapignore` (not `.skill-mapignore`) for live filter rebuilds.
  - Spec and JSON Schema (`spec/cli-contract.md` § `sm init`, `spec/schemas/project-config.schema.json` § `ignore`) updated; `spec/index.json` regenerated.
  - All in-repo fixtures, docs (ROADMAP, context/\*, AGENTS.md, web/app.js), tests, and skills (sm-tutorial, foblex-flow indirectly) updated in the same commit.

  Historical CHANGELOG entries that reference `.skill-mapignore` are intentionally left untouched — they document past behaviour.

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

  Spec: `spec/cli-contract.md` — the `sm guide` verb section is renamed to `sm tutorial`. Same shape, same exit codes, same `--force` semantics — only the identifier flips. Materialised file becomes `<cwd>/sm-tutorial.md`; integrity block in `spec/index.json` regenerated.

  CLI (`@skill-map/cli`): `sm guide` → `sm tutorial`; `src/cli/commands/guide.ts` → `tutorial.ts` (`GuideCommand` → `TutorialCommand`, `SM_GUIDE_FILENAME` → `SM_TUTORIAL_FILENAME`); `src/cli/i18n/guide.texts.ts` → `tutorial.texts.ts` (`GUIDE_TEXTS` → `TUTORIAL_TEXTS`, all string templates updated to mention `sm-tutorial.md` and `@sm-tutorial.md`); `src/tsup.config.ts` build step `copyGuideSkill()` → `copyTutorialSkill()` writing the bundled payload to `dist/cli/tutorial/sm-tutorial.md` instead of `dist/cli/guide/sm-guide.md`. Test file `src/test/guide-cli.test.ts` → `tutorial-cli.test.ts` with updated regex assertions and SKILL.md byte-match anchor pointing at `.claude/skills/sm-tutorial/SKILL.md`.

  Skill: `.claude/skills/sm-guide/` → `.claude/skills/sm-tutorial/`. Frontmatter `name: sm-guide` → `sm-tutorial`. Triggers list updated (`"tutorial", "sm-tutorial", "tutorial me", "start the tutorial"`). Internal whitelist updated (`sm-tutorial.md`, `tutorial-state.yml`, `sm-tutorial-report.md`). Runtime state file renamed `guide-state.yml` → `tutorial-state.yml` (top-level YAML key `guide:` → `tutorial:`). Report file renamed `sm-guide-report.md` → `sm-tutorial-report.md`. Colloquial Spanish "guía" inside tester-facing prose stays where it reads naturally — only identifiers (path names, command names, frontmatter, technical references) flip to `tutorial`.

  ROADMAP: setup-and-state verb table updated to `sm tutorial [--force]`.

  No backwards-compat alias is shipped: the tester base for this verb is tiny and a clean break is safer than maintaining two names.

## 0.14.1

### Patch Changes

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

  Spec / docs:

  - `spec/schemas/node.schema.json` — the top-level `description` previously read "built-in kinds today are skill, agent, command, hook, note", which suggested those kinds were a kernel-level concept. They are not — the kernel treats `kind` as an open string, and the five names are emitted by the **built-in Claude Provider**. Re-worded to attribute the catalog to the Claude Provider, matching the wording already used on the `kind` field, in `spec/README.md`, in `src/kernel/types.ts`, and in `src/kernel/adapters/sqlite/schema.ts`.
  - `src/test/extractor-applicable-kinds.test.ts` — three comments tightened from "built-in kind" to "built-in Claude Provider kind" for consistency.

  Internal CLI refactors (no behaviour change):

  - `src/cli/commands/config.ts` — extracted an `isPlainObject` predicate (replaces the duplicated `!!v && typeof v === 'object' && !Array.isArray(v)` check inside `enumerateConfigPaths`) and a `safeGetAtPath` helper that wraps `getAtPath` + `ForbiddenSegmentError` handling so each read verb's `run()` no longer repeats the try/catch + instanceof shape.
  - `src/cli/commands/db.ts` — pulled the SQL number serialiser into `formatSqlNumber` (NaN / ±Infinity collapse to NULL) so `formatSqlValue` reads as a flat dispatcher.
  - `src/cli/util/parse-error.ts` — moved the verb-scoped error formatting (incl. the missing-positionals special case) into a `formatVerbScopedError` helper so the top-level dispatcher in `formatParseError` stays flat. Removed the now-stale "dispatcher pattern" eslint-disable comment.
  - `src/kernel/adapters/sqlite/scan-load.ts` — tightened `parseJsonObject` / `parseJsonArray` null checks from `s == null` to `s === null || s === undefined` to remove the implicit-coercion pattern flagged by lint.

  No contract change (no field/type/required edits). `spec/index.json` regenerated.

## 0.14.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

  `sm` invoked with no arguments now starts the Web UI server when a
  `.skill-map/` project exists in the current working directory
  (equivalent to `sm serve`). When no project is found, it prints a
  one-line hint pointing to `sm init` and `sm --help` on stderr and
  exits with code `2`. `sm --help` and `sm -h` continue to print
  top-level help — help is now reserved for explicit flags.

  **Spec change** (`spec/cli-contract.md` §Binary): the prior wording —
  _"`sm`, `sm --help`, `sm -h` MUST all print top-level help"_ — is
  replaced by two separate clauses. Help invocation requires `--help` or
  `-h`; bare invocation routes to the server with the hint-and-exit
  fallback when no project exists.

  **CLI change** (`src/cli/entry.ts`): empty argv is intercepted before
  Clipanion sees it. If `defaultProjectDbPath(cwd)` exists, the args
  are rewritten to `['serve']`. Otherwise the hint is printed via the
  `tx()` i18n shim and the process exits `2`. `RootHelpCommand` no
  longer carries `Command.Default`; it remains the handler for `--help`
  and `-h` only.

  **Why pre-1.0 minor instead of major**: `spec/` and `src/` are both
  in `0.Y.Z`. Per `spec/versioning.md` §Pre-1.0, breaking changes ship
  as minor bumps until the deliberate 1.0 stabilization. The conformance
  suite required no updates (no case asserted bare-sm = help).

## 0.13.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

  Pure documentation changes; no normative schema or code changes.

  `@skill-map/spec`:

  - `architecture.md` — terse rewrite of §Provider · `kinds` catalog (now lists three required fields: `schema`, `defaultRefreshAction`, `ui`); new §Provider · `ui` presentation section documenting the label / color / colorDark / emoji / icon contract; §Stability section updated for the six extension kinds + Hook trigger set.
  - `plugin-author-guide.md` — Provider section gains the `ui` block documentation alongside `schema` and `defaultRefreshAction`; example manifest carries both icon variants (`pi` + `svg`); migration notes stripped under greenfield framing.
  - `cli-contract.md` — §Server documents the `kindRegistry` envelope field on every payload-bearing variant (sentinel envelopes — health/scan/graph — exempt).
  - `conformance/coverage.md` — row 18 (`extensions/provider.schema.json`) flipped 🔴 → 🟡, points at the new `plugin-missing-ui-rejected` case; new §Stability section.
  - `conformance/README.md` — drop "(Phase 5 / A.13 of spec 0.8.0)" historical phase markers.
  - `db-schema.md`, `plugin-author-guide.md` — fix `pisar` typo (Spanish leaked into English) → "are simply overwritten".
  - `CHANGELOG.md` — aggressive sweep: 2114 → 77 lines (96% reduction). Every release gets a 1–3 line greenfield summary. Drops the `Files touched`, `Migration for consumers`, `Out of scope`, `Why`, and per-step decision sub-sections. Drops commit-hash prefixes and `Pre-1.0 minor per versioning.md` boilerplate from every entry. The `[Unreleased]` section preserves the three in-flight Step 14 entries.
  - `conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/{plugin.json,provider.js}` — recovered (lost in the merge from `main` due to `.gitignore` masking gitignored-but-tracked files; `git add -f` brings them back into the index).

  `@skill-map/cli`:

  - `src/README.md` — Status section greenfield (terse: pre-1.0, what's next, what's after); usage examples expanded with `sm serve` + monorepo dev scripts.
  - `src/built-in-plugins/README.md` — drop the contradictory "empty on purpose" framing; document the actual built-in inventory (Claude Provider + Extractors + Rules + Formatter + `validate-all`).

  `@skill-map/testkit`:

  - `testkit/README.md` — rewrite end-to-end against the actual exported helper names (`runExtractorOnFixture` instead of the long-renamed `runDetectorOnFixture`); align example with the `extract(ctx) → void` Extractor shape and the `enabled` plugin status enum.

  Plus `ui/` README rewrite, root README + ES mirror Status / badge bumps + `sm serve` mention + Star History embed, AGENTS.md greenfield BFF section, CONTRIBUTING.md refresh, ROADMAP.md greenfield sweep (`Earlier prose` blocks stripped, decision log reframed without rename history, 14.6+ content preserved), web copy revision (How-it-works section), examples/hello-world rewritten to the Extractor model with passing tests, and the spec/index.json regeneration that goes with it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## [Unreleased]

### Minor

- **Provider-driven kind presentation + `kindRegistry` envelope.** The Provider extension surface gains a required `kinds[*].ui` block (`label`, `color`, optional `colorDark`, optional `emoji`, optional discriminated icon `{ kind: 'pi', id }` or `{ kind: 'svg', path }`). Every payload-bearing REST envelope variant embeds a required `kindRegistry` field; sentinel envelopes (`health`, `scan`, `graph`) stay exempt. New conformance case `plugin-missing-ui-rejected` locks the loader's behaviour against drop-in Providers that omit the `ui` block.

- **`/api/nodes/:pathB64?include=body` body opt-in.** The single-node detail endpoint accepts `?include=body` to add `item.body: string | null` (read from disk on demand; `null` when the source file is missing or unreadable). Single-node response shape is `{ schemaVersion, kind: 'node', item, links: { incoming, outgoing }, issues }`. The body reader refuses absolute paths and any relative path that resolves outside the scope root.

- **`/ws` WebSocket protocol + watcher contract.** `### Server` documents the wire envelope (delegated to `job-events.md` §Common envelope), the event catalog (`scan.started` / `scan.progress` / `scan.completed` plus `extractor.completed` / `rule.completed` / `extension.error` plus the BFF-internal advisories `watcher.started` / `watcher.error`), connection lifecycle, the backpressure rule (4 MiB `bufferedAmount` → close 1009 + unregister), and the loopback-only assumption. `sm serve --no-watcher` flag added.

## 0.12.0

### Minor

- **`sm serve` + Hono BFF skeleton.** New `### Server` subsection in `cli-contract.md`. Endpoints at this bump: `GET /api/health` (real), `ALL /api/*` (structured 404 stub), `GET /ws` (no-op upgrade — closes with code 1000 + reason `'no broadcaster yet'`), static handler + SPA fallback. Loopback-only through v0.6.0; boot resilient to a missing DB (`/api/health` reports `db: 'missing'`). `sm serve` flag set: `--port` (default 4242), `--host` (default 127.0.0.1), `--scope`, `--db`, `--no-built-ins`, `--no-plugins`, `--open` / `--no-open`, `--dev-cors`, `--ui-dist`.

## 0.11.0

### Minor

- **Job artifacts move into the database (content-addressed).** New `state_job_contents(content_hash PK, content, created_at)`; `state_jobs.file_path` removed (rendered content fetched via join). `state_executions.report_path` → `state_executions.report_json` (parsed-JSON-on-read). `Job.filePath` removed; `ExecutionRecord.reportPath` → `ExecutionRecord.report` (parsed JSON / null). `RunnerPort.run(jobContent, options)` returns `{ report, ... }` — path-based reporting is no longer part of the port contract. `sm job preview` reads from the DB; `sm job claim --json` returns `{ id, nonce, content }`; `sm record --report <path-or-dash>` accepts a file path or stdin; `sm job prune --orphan-files` removed (the verb auto-collects orphan content rows). `sm doctor` integrity checks updated. Event payload renames: `job.spawning.data.jobFilePath` → `contentHash`; `job.callback.received.data.reportPath` and `job.completed.data.reportPath` → `executionId`. The `job-file-missing` failure-reason enum is preserved with shifted semantics: it now flags a missing `state_job_contents` row (DB-corruption-only state).

## 0.10.0

### Minor

- **`Node.kind` opens to any Provider-declared string.** `node.schema.json#/properties/kind` becomes `{ type: 'string', minLength: 1 }`; the `CHECK in (...)` SQL constraints on `scan_nodes.kind` and `state_summaries.kind` drop; `extensions/action.schema.json#/.../filter/kind` widens to a string array. Providers declare their own kind catalog through the `kinds` map; the spec no longer enumerates a closed set.

## 0.7.0

### Minor

- **Execution modes lifted to a first-class architectural property.** `architecture.md` gains §Execution modes defining the per-kind capability matrix: Extractor / Rule / Action / Hook are dual-mode (declared in manifest); Provider and Formatter are deterministic-only (boundary-positioned). Extractor / Rule schemas gain optional `mode` (default `deterministic`); Action's `mode` enum becomes `deterministic` / `probabilistic`; Provider / Formatter forbid the field.

## 0.6.1

### Patch

- **Config folder rename** — `.skill-map.json` (single project-root file) → `.skill-map/settings.json` inside the canonical `.skill-map/` scope folder, with a sibling `.skill-map/settings.local.json` for per-machine overrides.

## 0.6.0

### Minor

- **Persisted scan-result metadata.** New `scan_meta` table backs `loadScanResult` so `scope` / `roots` / `scannedAt` / `scannedBy` / `adapters` / `stats.{filesWalked,filesSkipped,durationMs}` are real values instead of synthesised on read.

## 0.5.0

### Minor

- **`spec/index.json` integrity sweep.** Reconciles `index.json` with the manifest changes documented in v0.3.0 but never written to the file. No prose / schema changes.

## 0.4.0

### Minor

- **`--all` documented as targeted fan-out** in `cli-contract.md`. Valid only on verbs whose contract explicitly lists it.

## 0.3.0

### Minor

- **`--all` promoted to a normative universal flag** in `cli-contract.md §Global flags`. Any verb that accepts a target identifier (`-n <node.path>`, `<job.id>`, `<plugin.id>`) MUST accept `--all` as "apply to every eligible target matching the verb's preconditions". Mutually exclusive with a positional target on the same invocation. Verbs where fan-out is nonsensical (`sm record`, `sm init`, `sm version`, `sm help`, `sm config get/set/reset/show`, `sm db *`, `sm serve`) MUST reject `--all` with exit `2`.

## 0.2.0

### Minor

- **`@skill-map/spec` published on npm.** First public release of the spec package.

## 0.1.0

### Minor

- **Initial public spec bootstrap.** Ships the JSON Schemas (draft 2020-12) for `Node` / `Link` / `Issue` / `ScanResult` / `ExecutionRecord` / `ProjectConfig` / `PluginsRegistry` / `Job` / `ReportBase` / `ConformanceCase` / `HistoryStats` plus the per-kind extension schemas (Provider / Extractor / Rule / Action / Formatter / Hook). Prose normative contracts: `cli-contract.md`, `architecture.md`, `db-schema.md`, `job-lifecycle.md`, `job-events.md`, `prompt-preamble.md`, `plugin-kv-api.md`. Conformance case `kernel-empty-boot` exercises the boot invariant (kernel boots and returns an empty `ScanResult` with zero registered extensions); `preamble-bitwise-match` is deferred to Step 10.
