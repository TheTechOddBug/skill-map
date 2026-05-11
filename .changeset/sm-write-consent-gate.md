---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

**Per-key locality — new `PROJECT_LOCAL_ONLY_KEYS` set**

Four config keys are now classified as **project-local only**: `allowEditSmFiles` (new), `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Valid layers for these values are `defaults`, `user`, `user-local`, `project-local`, `override`. **The committed `project` layer (`<cwd>/.skill-map/settings.json`) is forbidden** — values found there are stripped (with a warning) at load time. `writeConfigValue(...)` with `target: 'project'` for any of the four throws `ProjectLocalOnlyKeyError`.

Sister concept to the existing `USER_ONLY_KEYS` (still scoped to `updateCheck.enabled`):

| Set | Valid layers | Forbidden layer(s) |
|---|---|---|
| `USER_ONLY_KEYS` | `defaults`, `user`, `user-local`, `override` | `project`, `project-local` |
| `PROJECT_LOCAL_ONLY_KEYS` | `defaults`, `user`, `user-local`, `project-local`, `override` | `project` |

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
