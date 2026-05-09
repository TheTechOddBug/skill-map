---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

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
