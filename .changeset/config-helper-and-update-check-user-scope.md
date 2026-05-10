---
"@skill-map/cli": minor
"@skill-map/spec": patch
---

Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

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
