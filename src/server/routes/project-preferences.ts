/**
 * Project preferences route, read + write project-scope settings.
 *
 *   GET   /api/project-preferences        → current envelope
 *   PATCH /api/project-preferences        → mutate one or more sub-keys
 *
 * Today the envelope carries the privacy-sensitive scan key
 * `scan.referencePaths` (string[]).
 *
 * Every write is gated by the same "expanding the surface?"
 * predicate the CLI's `sm config set --yes` consumes, when the
 * incoming patch would open disk access outside the project root
 * AND `confirm: true` is not in the body, the route returns 412
 * `confirm-required` with the list of paths the change would
 * expose. The UI's Project section shows that list in a confirm
 * dialog and re-issues the PATCH with `confirm: true`.
 *
 * Persistence funnels through `core/config/helper:writeConfigValue`
 * with `target: 'project'`. Mirrors `routes/preferences.ts` for the
 * body-parsing convention (AJV via `makeBodyValidator` from
 * `server/util/parse-body.ts`) so the BFF stays consistent.
 */

import { statSync } from 'node:fs';

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import {
  projectPathExposure,
  projectFollowSymlinksExposure,
  readConfigValue,
  writeConfigValue,
} from '../../core/config/helper.js';
import { resolveScanPath } from '../../core/runtime/reference-paths-walker.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

export interface IProjectPreferencesEnvelope {
  /**
   * Committed (team-shared) project policy: when `false`, every
   * sidecar-writing extension is dropped from the scan and the sidecar
   * store refuses the write. Default `true`. See
   * `core/config/sidecar-consent:assertSidecarWritersAllowed`.
   */
  allowSidecarWriters: boolean;
  scan: {
    referencePaths: readonly string[];
    /**
     * Local, per-machine opt-in: when `true`, the scan follows a symlink
     * whose target escapes the project root. Default `false` (contained).
     * Project-local only (stripped from the committed layer); turning it
     * ON is surface-expanding (412 confirm gate), like `scan.referencePaths`.
     */
    followExternalSymlinks: boolean;
    /**
     * Committed (team-shared) policy: when `true`, the project root
     * `.gitignore` joins the scan's ignore stack. Default `false` (a
     * fresh project does not read `.gitignore`). Written to the committed
     * `project` layer like `allowSidecarWriters`; not privacy-gated (it
     * never reads outside the project root).
     */
    respectGitignore: boolean;
  };
  /**
   * Project-local UI preference: which topbar reminder message is shown
   * to a first-time user, advanced one step at a time by its dismiss
   * button. `0` (default): the Quick Start nudge. `1`: the `sm tutorial`
   * nudge. `2`: fully dismissed, the reminder never shows again.
   */
  tutorialReminderStep: number;
  /**
   * Project-local web-UI preferences (Settings > Project), persisted per
   * checkout in `settings.local.json`. `liveUpdates`: keep the map in
   * sync with `sm serve` (default `true`). `realtimeActivity`: light up
   * executing nodes (default `true`, subordinate to `liveUpdates`).
   * No confirm gate, neither expands disk access nor trusts code.
   */
  ui: {
    liveUpdates: boolean;
    realtimeActivity: boolean;
  };
  /**
   * Whether `sm serve` exposes the opt-in read-only MCP server at `/mcp`
   * (config key `mcp.server.enabled`, default `false`). The endpoint mounts at
   * serve BOOT, so a change here persists but only takes effect after an
   * `sm serve` restart, the UI surfaces that as a per-toggle hint. Written to
   * the project-local layer (a per-operator decision to expose a local server).
   */
  mcpServerEnabled: boolean;
  /**
   * Agent doorbell (config key `jobs.wakeOnSubmit`, default `false`,
   * `spec/job-lifecycle.md` §Agent doorbell): wake a registered agent
   * runtime when a submit survives its settle window unclaimed. Read
   * LIVE at wake time, so unlike `mcpServerEnabled` it takes effect
   * without a restart. Project-local (a per-operator token-spending
   * consent).
   */
  wakeOnSubmit: boolean;
}

interface IPatchBody {
  confirm?: boolean;
  allowSidecarWriters?: boolean;
  scan?: {
    referencePaths?: string[];
    followExternalSymlinks?: boolean;
    respectGitignore?: boolean;
  };
  tutorialReminderStep?: number;
  ui?: {
    liveUpdates?: boolean;
    realtimeActivity?: boolean;
  };
  mcpServerEnabled?: boolean;
  wakeOnSubmit?: boolean;
}

export function registerProjectPreferencesRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/project-preferences', (c) => {
    return c.json(buildEnvelope(deps));
  });

  app.patch('/api/project-preferences', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    await applyPatch(deps, body);
    return c.json(buildEnvelope(deps));
  });
}

function buildEnvelope(deps: IRouteDeps): IProjectPreferencesEnvelope {
  const cwd = deps.runtimeContext.cwd;
  return {
    allowSidecarWriters:
      readConfigValue<boolean>('allowSidecarWriters', {
        cwd,
        default: true,
      }) ?? true,
    scan: buildScanEnvelope(cwd),
    tutorialReminderStep:
      readConfigValue<number>('tutorialReminderStep', {
        cwd,
        default: 0,
      }) ?? 0,
    ui: {
      liveUpdates:
        readConfigValue<boolean>('ui.liveUpdates', {
          cwd,
          default: true,
        }) ?? true,
      realtimeActivity:
        readConfigValue<boolean>('ui.realtimeActivity', {
          cwd,
          default: true,
        }) ?? true,
    },
    mcpServerEnabled:
      readConfigValue<boolean>('mcp.server.enabled', {
        cwd,
        default: false,
      }) ?? false,
    wakeOnSubmit:
      readConfigValue<boolean>('jobs.wakeOnSubmit', {
        cwd,
        default: false,
      }) ?? false,
  };
}

/** Build the `scan` sub-envelope (split out to keep `buildEnvelope` under the lint cap). */
function buildScanEnvelope(cwd: string): IProjectPreferencesEnvelope['scan'] {
  return {
    referencePaths:
      readConfigValue<string[]>('scan.referencePaths', { cwd, default: [] }) ?? [],
    followExternalSymlinks:
      readConfigValue<boolean>('scan.followExternalSymlinks', { cwd, default: false }) ?? false,
    respectGitignore:
      readConfigValue<boolean>('scan.respectGitignore', { cwd, default: false }) ?? false,
  };
}

interface IPlannedWrite {
  key: 'scan.referencePaths';
  value: unknown;
}

async function applyPatch(deps: IRouteDeps, body: IPatchBody): Promise<void> {
  const cwd = deps.runtimeContext.cwd;

  // Committed sidecar-writer policy: a top-level boolean written to the
  // team-shared `project` layer. No privacy / existence gate, it is a
  // restriction, safe to commit.
  const policyChanged =
    typeof body.allowSidecarWriters === 'boolean' &&
    writeSidecarWritersPolicy(body.allowSidecarWriters, cwd);

  // Committed `scan.respectGitignore` policy: a team-shared boolean
  // written to the `project` layer (NOT project-local, unlike the other
  // `scan.*` keys). No gate, it never reads outside the project root. It
  // changes what the scan indexes, so a change restarts the watcher.
  const respectGitignoreChanged =
    typeof body.scan?.respectGitignore === 'boolean' &&
    writeRespectGitignorePolicy(body.scan.respectGitignore, cwd);

  // scan.* writes carry their own existence + privacy gates (see
  // `applyScanWrites`); `attempted` drives the cache reload, `mutated`
  // (an actual add / remove) drives the watcher restart.
  const scan = applyScanWrites(body, cwd);

  // Local external-symlink opt-in: a project-local-only boolean. Turning
  // it ON expands the disk-read surface (the scan follows escaping
  // links), so it carries its own 412 confirm gate (see
  // `applyFollowSymlinksWrite`). It also changes what the scan indexes,
  // so a change restarts the watcher below.
  const followChanged = applyFollowSymlinksWrite(body, cwd);

  // Project-local UI preference: the tutorial-reminder step. A plain
  // integer written to the gitignored project-local layer, no privacy or
  // confirm gate (it neither expands disk access nor trusts code).
  const reminderChanged = applyTutorialReminderWrite(body, cwd);

  // Project-local web-UI preferences (Settings > Project): plain booleans
  // written to the gitignored project-local layer, no privacy or confirm
  // gate. They only steer the SPA's live channel, so no watcher restart.
  const uiChanged = applyUiWrites(body, cwd);

  // Project-local MCP-server enable. Boot-time: the `/mcp` mount happens in
  // `createApp` at serve boot, so persisting it here has NO live effect and a
  // watcher restart would not remount the route. It only needs a cache reload
  // so the GET reflects the new value; the UI tells the operator to restart
  // `sm serve`.
  const mcpChanged = applyMcpServerWrite(body, cwd);

  // Project-local agent-doorbell consent (`jobs.wakeOnSubmit`). Read LIVE
  // by the doorbell at wake time, so persisting it is the whole effect:
  // no restart, no watcher involvement, only the config-cache reload.
  const wakeChanged = applyWakeOnSubmitWrite(body, cwd);

  // Best-effort watcher restart: the runtime re-reads config every
  // batch so the next file edit picks the change up anyway, but the
  // restart guarantees the operator sees the effect (new path list,
  // dropped / restored writer buttons, external-symlink toggle) without
  // waiting for an unrelated edit. Failures here do not roll back the
  // on-disk write. `.some(Boolean)` keeps this orchestrator under the
  // cyclomatic budget as keys grow.
  const shouldRestart = [
    policyChanged,
    respectGitignoreChanged,
    scan.mutated,
    followChanged,
  ].some(Boolean);
  const shouldReload = [
    policyChanged,
    respectGitignoreChanged,
    scan.attempted,
    reminderChanged,
    followChanged,
    uiChanged,
    mcpChanged,
    wakeChanged,
  ].some(Boolean);
  if (shouldRestart) await maybeRestartWatcher(deps);
  // Successful writes mutate the on-disk config; the cached view would
  // now hand out stale state. Drop it so the next consumer re-reads
  // from disk.
  if (shouldReload) deps.configService.reload();
}

/**
 * Apply the `scan.followExternalSymlinks` sub-key of the patch. Turning
 * the local opt-in ON lets the scan follow symlinks whose target escapes
 * the project (disk-read-surface expansion), so without `confirm: true`
 * the route returns 412 `confirm-required`. Turning it OFF (or a no-op) is
 * not gated. Persisted to the gitignored `project-local` layer (the key is
 * project-local only). Handled separately from `applyScanWrites` (which
 * runs the path-existence / path-exposure gates for the list-shaped
 * `referencePaths`); this is the boolean-flip counterpart.
 * Returns `true` when the value actually changed.
 */
function applyFollowSymlinksWrite(body: IPatchBody, cwd: string): boolean {
  const next = body.scan?.followExternalSymlinks;
  if (next === undefined) return false;
  const before =
    readConfigValue<boolean>('scan.followExternalSymlinks', { cwd, default: false }) ?? false;
  if (before === next) return false;

  // Confirm gate: only a turn-ON expands the surface.
  if (projectFollowSymlinksExposure({ value: next, cwd }).expandsSurface && body.confirm !== true) {
    throw new HTTPException(412, {
      message: SERVER_TEXTS.projectPrefsFollowSymlinksConfirmRequired,
    });
  }

  try {
    writeConfigValue('scan.followExternalSymlinks', next, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'scan.followExternalSymlinks',
        message: formatErrorMessage(err),
      }),
    });
  }
  log.warn(tx(SERVER_TEXTS.projectPrefsFollowSymlinksSet, { value: String(next) }));
  return true;
}

/**
 * Apply the `tutorialReminderStep` key of the patch: a project-local
 * UI preference (the web UI's topbar tutorial reminder sequence). No
 * privacy / confirm gate, it neither expands disk access nor trusts
 * code. Persisted to the gitignored `project-local` layer (the key is
 * project-local only). Returns `true` when the value actually changed,
 * so the caller reloads the config cache.
 */
function applyTutorialReminderWrite(body: IPatchBody, cwd: string): boolean {
  const next = body.tutorialReminderStep;
  if (next === undefined) return false;
  const before =
    readConfigValue<number>('tutorialReminderStep', { cwd, default: 0 }) ?? 0;
  if (before === next) return false;
  try {
    writeConfigValue('tutorialReminderStep', next, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'tutorialReminderStep',
        message: formatErrorMessage(err),
      }),
    });
  }
  return true;
}

/**
 * Apply the `ui.*` sub-keys of the patch: project-local web-UI
 * preferences (`ui.liveUpdates`, `ui.realtimeActivity`). No privacy or
 * confirm gate, they only steer the SPA's live channel. Persisted to
 * the gitignored `project-local` layer (the keys are project-local
 * only). Returns `true` when at least one value actually changed, so
 * the caller reloads the config cache.
 */
function applyUiWrites(body: IPatchBody, cwd: string): boolean {
  if (!body.ui) return false;
  let changed = false;
  const entries = [
    { key: 'ui.liveUpdates', next: body.ui.liveUpdates },
    { key: 'ui.realtimeActivity', next: body.ui.realtimeActivity },
  ] as const;
  for (const { key, next } of entries) {
    if (next === undefined) continue;
    const before = readConfigValue<boolean>(key, { cwd, default: true }) ?? true;
    if (before === next) continue;
    try {
      writeConfigValue(key, next, { target: 'project-local', cwd });
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
          key,
          message: formatErrorMessage(err),
        }),
      });
    }
    changed = true;
  }
  return changed;
}

/**
 * Apply the `mcpServerEnabled` key of the patch (config key
 * `mcp.server.enabled`): the opt-in read-only MCP server. Boot-time, so
 * persisting it here has no live effect, the `/mcp` mount needs an `sm serve`
 * restart. Written to the gitignored project-local layer (a per-operator
 * decision to expose a local server), no privacy / confirm gate. Returns `true`
 * when the value actually changed, so the caller reloads the config cache.
 */
function applyMcpServerWrite(body: IPatchBody, cwd: string): boolean {
  const next = body.mcpServerEnabled;
  if (next === undefined) return false;
  const before = readConfigValue<boolean>('mcp.server.enabled', { cwd, default: false }) ?? false;
  if (before === next) return false;
  try {
    writeConfigValue('mcp.server.enabled', next, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'mcp.server.enabled',
        message: formatErrorMessage(err),
      }),
    });
  }
  log.warn(tx(SERVER_TEXTS.projectPrefsMcpServerSet, { value: String(next) }));
  return true;
}

/**
 * Apply the `wakeOnSubmit` key (config key `jobs.wakeOnSubmit`): the
 * agent doorbell's consent gate. Written to the gitignored project-local
 * layer (an autonomous agent spending the operator's tokens must never
 * be switched on via the shared repo); read live by the doorbell, so no
 * restart hint applies. Returns `true` when the value actually changed.
 */
function applyWakeOnSubmitWrite(body: IPatchBody, cwd: string): boolean {
  const next = body.wakeOnSubmit;
  if (next === undefined) return false;
  const before = readConfigValue<boolean>('jobs.wakeOnSubmit', { cwd, default: false }) ?? false;
  if (before === next) return false;
  try {
    writeConfigValue('jobs.wakeOnSubmit', next, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'jobs.wakeOnSubmit',
        message: formatErrorMessage(err),
      }),
    });
  }
  log.warn(tx(SERVER_TEXTS.projectPrefsWakeOnSubmitSet, { value: String(next) }));
  return true;
}


/**
 * Apply the `scan.*` sub-keys of the patch (today only
 * `scan.referencePaths`). Runs the existence gate then the privacy gate
 * before persisting, both throw `HTTPException` funnelled through the
 * global `app.onError`. Extracted from `applyPatch` so the orchestrator
 * stays inside the lint complexity budget once the policy branch landed
 * alongside it.
 *
 * Returns `attempted` (any scan write was requested, so the config cache
 * must reload) and `mutated` (an actual add / remove happened, so the
 * watcher should restart).
 */
function applyScanWrites(
  body: IPatchBody,
  cwd: string,
): { attempted: boolean; mutated: boolean } {
  const writes = collectWrites(body);
  if (writes.length === 0) return { attempted: false, mutated: false };

  // Existence gate: every NEW entry (not already present in the current
  // config) must resolve to a directory on disk. Stops typos and stale
  // paths at write time; pre-existing entries are not re-validated so a
  // path that disappeared between sessions does not block removing OTHER
  // paths.
  const missingPaths = collectMissingPaths(writes, cwd);
  if (missingPaths.length > 0) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPathNotFound, {
        paths: missingPaths.join(', '),
      }),
    });
  }

  // Privacy gate: aggregate every exposure across the patch and refuse
  // the write when ANY sub-key expands the surface without an explicit
  // `confirm: true`.
  const exposures = writes
    .map((w) => projectPathExposure({ key: w.key, value: w.value, cwd }))
    .filter((e) => e.expandsSurface);
  if (exposures.length > 0 && body.confirm !== true) {
    const exposed = exposures.flatMap((e) => e.exposedPaths);
    throw new HTTPException(412, {
      message: tx(SERVER_TEXTS.projectPrefsConfirmRequired, {
        paths: exposed.join(', '),
      }),
    });
  }

  let mutated = false;
  for (const w of writes) {
    if (runWrite(w, cwd)) mutated = true;
  }
  return { attempted: true, mutated };
}

/**
 * Persist the committed `allowSidecarWriters` policy to the team-shared
 * `project` layer (NOT project-local: the whole point is that the policy
 * travels with the repo to every collaborator). Returns `true` when the
 * value actually changed, so the caller can decide on the watcher
 * restart. Throws `HTTPException(400)` on persist failure, funnelled
 * through the global `app.onError` like the scan writes.
 */
function writeSidecarWritersPolicy(value: boolean, cwd: string): boolean {
  const before =
    readConfigValue<boolean>('allowSidecarWriters', { cwd, default: true }) ?? true;
  if (before === value) return false;
  try {
    writeConfigValue('allowSidecarWriters', value, { target: 'project', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'allowSidecarWriters',
        message: formatErrorMessage(err),
      }),
    });
  }
  log.warn(
    tx(SERVER_TEXTS.projectPrefsSidecarWritersSet, { value: String(value) }),
  );
  return true;
}

/**
 * Persist the committed `scan.respectGitignore` policy to the team-shared
 * `project` layer (NOT project-local: the whole point is that the ignore
 * policy travels with the repo). Mirrors `writeSidecarWritersPolicy`: no
 * privacy / confirm gate (it never reads outside the project root).
 * Returns `true` when the value actually changed, so the caller can
 * restart the watcher (the flag changes what the scan indexes). Throws
 * `HTTPException(400)` on persist failure.
 */
function writeRespectGitignorePolicy(value: boolean, cwd: string): boolean {
  const before =
    readConfigValue<boolean>('scan.respectGitignore', { cwd, default: false }) ?? false;
  if (before === value) return false;
  try {
    writeConfigValue('scan.respectGitignore', value, { target: 'project', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: 'scan.respectGitignore',
        message: formatErrorMessage(err),
      }),
    });
  }
  log.warn(
    tx(SERVER_TEXTS.projectPrefsRespectGitignoreSet, { value: String(value) }),
  );
  return true;
}

function collectWrites(body: IPatchBody): IPlannedWrite[] {
  if (!body.scan) return [];
  const out: IPlannedWrite[] = [];
  if (Array.isArray(body.scan.referencePaths)) {
    out.push({ key: 'scan.referencePaths', value: body.scan.referencePaths });
  }
  return out;
}

/**
 * For each planned write, diff the incoming array against the
 * currently-persisted one and validate that every NEW entry resolves
 * to an existing directory on disk (after `~` expansion + relative-
 * to-cwd resolution). Returns the list of entries (original strings,
 * not the expanded paths) that failed the check.
 */
function collectMissingPaths(writes: IPlannedWrite[], cwd: string): string[] {
  const missing: string[] = [];
  for (const w of writes) {
    if (!Array.isArray(w.value)) continue;
    const current = readConfigValue<string[]>(w.key, { cwd, default: [] }) ?? [];
    const currentSet = new Set(current);
    // AJV already validated `items: { type: 'string', pattern: '...' }`
    // upstream, so every entry is a string here.
    for (const entry of w.value as string[]) {
      if (currentSet.has(entry)) continue;
      if (!isExistingDirectory(entry, cwd)) missing.push(entry);
    }
  }
  return missing;
}

/**
 * Diff the persisted-before-the-write snapshot against the patch's
 * incoming array and emit one `log.info` line per added / removed
 * path. Lets the operator see settings-side mutations land on the
 * server's stderr without opening the DB or the config file. Paths
 * are sanitised through `sanitizeForTerminal` so a hostile entry
 * cannot smuggle ANSI / C0 controls into the log stream.
 */
/**
 * Best-effort watcher reload. Swallows + logs failures so a flaky
 * chokidar boot does not roll back the on-disk config write; the
 * advisory message tells the operator to restart `sm serve`
 * manually in that case.
 */
async function maybeRestartWatcher(deps: IRouteDeps): Promise<void> {
  const watcher = deps.watcherHolder.current;
  if (!watcher) return;
  try {
    await watcher.restart();
  } catch (err) {
    log.warn(
      tx(SERVER_TEXTS.projectPrefsWatcherRestartFailed, {
        message: formatErrorMessage(err),
      }),
    );
  }
}

/**
 * Snapshot the current persisted value, persist the write, then log
 * the diff. Extracted from `applyPatch` so the cyclomatic budget of
 * the per-write step (snapshot + write + log) does not blow up the
 * orchestrator's complexity. Throws `HTTPException(400)` on persist
 * failure with the catalog message; the caller funnels through the
 * global `app.onError`.
 *
 * Returns `true` when the persisted value actually changed (added /
 * removed entries), so the caller can decide whether to fire the
 * watcher restart. A no-op write (same array contents) returns
 * `false` and the watcher stays untouched.
 */
function runWrite(w: IPlannedWrite, cwd: string): boolean {
  // Snapshot the persisted array BEFORE the write so we can diff
  // (and log) after a successful persist. Reads from the loader
  // cache, no extra disk hit.
  const before = readConfigValue<string[]>(w.key, { cwd, default: [] }) ?? [];
  try {
    // PROJECT_LOCAL_ONLY keys (`scan.referencePaths`,
    // `allowEditSmFiles`) can never live in the committed project
    // layer, the loader strips them with a warning. Persist to
    // `project-local` (gitignored, per-checkout) instead.
    writeConfigValue(w.key, w.value, { target: 'project-local', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.projectPrefsPersistFailed, {
        key: w.key,
        message: formatErrorMessage(err),
      }),
    });
  }
  logPathChanges(w.key, before, w.value, cwd);
  return arrayChanged(before, w.value);
}

/**
 * Set-equality check, ignores ordering. The route's UX is "manage a
 * list of paths"; reordering the array via PATCH counts as a no-op,
 * only added / removed entries warrant a watcher restart.
 */
function arrayChanged(before: readonly string[], nextValue: unknown): boolean {
  if (!Array.isArray(nextValue)) return false;
  const next = nextValue as string[];
  if (before.length !== next.length) return true;
  const beforeSet = new Set(before);
  for (const p of next) {
    if (!beforeSet.has(p)) return true;
  }
  return false;
}

function logPathChanges(
  key: string,
  before: readonly string[],
  nextValue: unknown,
  cwd: string,
): void {
  if (!Array.isArray(nextValue)) return;
  const next = nextValue as string[];
  const beforeSet = new Set(before);
  const nextSet = new Set(next);
  for (const path of next) {
    if (beforeSet.has(path)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectPrefsPathAdded, {
        key,
        detail: formatPathDetail(path, cwd),
      }),
    );
  }
  for (const path of before) {
    if (nextSet.has(path)) continue;
    log.warn(
      tx(SERVER_TEXTS.projectPrefsPathRemoved, {
        key,
        detail: formatPathDetail(path, cwd),
      }),
    );
  }
}

/**
 * Compose the log line's `{{detail}}` for one path entry:
 *
 *   - home (`~/foo`, `~`)           → `~/foo (home) → /home/<u>/foo`
 *   - relative (`./foo`, `foo/bar`) → `foo/bar (relative) → <cwd>/foo/bar`
 *   - absolute (`/foo`, `/Volumes`) → `/foo (absolute)`
 *
 * Both the user-typed string and the resolved absolute path go
 * through `sanitizeForTerminal` so a hostile config value cannot
 * smuggle ANSI / C0 controls into the operator's log stream.
 */
function formatPathDetail(path: string, cwd: string): string {
  const safePath = sanitizeForTerminal(path);
  if (path.startsWith('~/') || path === '~') {
    const abs = sanitizeForTerminal(resolveScanPath(path, cwd));
    return `${safePath} (home) → ${abs}`;
  }
  if (path.startsWith('/')) {
    return `${safePath} (absolute)`;
  }
  const abs = sanitizeForTerminal(resolveScanPath(path, cwd));
  return `${safePath} (relative) → ${abs}`;
}

/**
 * Resolve `entry` through `resolveScanPath` (expands `~`, joins to
 * cwd) and `statSync` it. Returns `true` only when the resolved path
 * is a directory on disk; any FS error counts as missing.
 */
function isExistingDirectory(entry: string, cwd: string): boolean {
  const abs = resolveScanPath(entry, cwd);
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Body schema for `PATCH /api/project-preferences`. Requires at least
 * one mutable key (`allowSidecarWriters` and/or a `scan` block) via the
 * `anyOf`; rejects unknown keys at every level
 * (`additionalProperties: false`). The `confirm` flag is optional and
 * only consumed by the privacy gate when the patch would expand disk
 * access.
 */
const PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  anyOf: [
    { required: ['allowSidecarWriters'] },
    { required: ['scan'] },
    { required: ['tutorialReminderStep'] },
    { required: ['ui'] },
    { required: ['mcpServerEnabled'] },
    { required: ['wakeOnSubmit'] },
  ],
  properties: {
    confirm: { type: 'boolean' },
    allowSidecarWriters: { type: 'boolean' },
    tutorialReminderStep: { type: 'integer', minimum: 0, maximum: 2 },
    mcpServerEnabled: { type: 'boolean' },
    wakeOnSubmit: { type: 'boolean' },
    ui: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        liveUpdates: { type: 'boolean' },
        realtimeActivity: { type: 'boolean' },
      },
    },
    scan: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        referencePaths: {
          type: 'array',
          items: { type: 'string', pattern: '^[^,]+$' },
        },
        followExternalSymlinks: { type: 'boolean' },
        respectGitignore: { type: 'boolean' },
      },
    },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.projectPrefsBodyNotJson,
  notObject: SERVER_TEXTS.projectPrefsBodyNotObject,
  invalid: SERVER_TEXTS.projectPrefsBodyEmpty,
  mapping: {
    ':anyOf': SERVER_TEXTS.projectPrefsBodyEmpty,
    '/scan:minProperties': SERVER_TEXTS.projectPrefsBodyEmpty,
    '/scan:type:object': SERVER_TEXTS.projectPrefsScanNotObject,
    '/confirm:type:boolean': SERVER_TEXTS.projectPrefsConfirmNotBoolean,
    '/allowSidecarWriters:type:boolean': SERVER_TEXTS.projectPrefsSidecarWritersNotBoolean,
    '/tutorialReminderStep:type:integer': SERVER_TEXTS.projectPrefsReminderStepInvalid,
    '/tutorialReminderStep:minimum': SERVER_TEXTS.projectPrefsReminderStepInvalid,
    '/tutorialReminderStep:maximum': SERVER_TEXTS.projectPrefsReminderStepInvalid,
    '/scan/referencePaths:type:array': tx(SERVER_TEXTS.projectPrefsListNotArray, { key: 'scan.referencePaths' }),
    '/scan/referencePaths/*:type:string': tx(SERVER_TEXTS.projectPrefsListEntryNotString, { key: 'scan.referencePaths' }),
    '/scan/referencePaths/*:pattern': SERVER_TEXTS.projectPrefsEntryHasComma,
    '/scan/followExternalSymlinks:type:boolean': SERVER_TEXTS.projectPrefsFollowSymlinksNotBoolean,
    '/scan/respectGitignore:type:boolean': SERVER_TEXTS.projectPrefsRespectGitignoreNotBoolean,
    '/ui:minProperties': SERVER_TEXTS.projectPrefsBodyEmpty,
    '/ui:type:object': SERVER_TEXTS.projectPrefsUiNotObject,
    '/ui/liveUpdates:type:boolean': SERVER_TEXTS.projectPrefsLiveUpdatesNotBoolean,
    '/ui/realtimeActivity:type:boolean': SERVER_TEXTS.projectPrefsRealtimeActivityNotBoolean,
    '/mcpServerEnabled:type:boolean': SERVER_TEXTS.projectPrefsMcpServerNotBoolean,
  },
});
