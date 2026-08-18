/**
 * Shared live-activity install engine (`spec/provider-activity.md`
 * §Install management over HTTP + `cli-contract.md` §Activity).
 *
 * Both operator surfaces drive the SAME sequences through this module:
 * the CLI verbs (`sm activity install|uninstall <provider>`, which own
 * the TTY consent prompt and terminal output) and the BFF routes
 * (`/api/activity/install|uninstall`, which own the HTTP 412 consent
 * gate). Keeping the mechanics here guarantees the two never drift:
 * one marker, one refresh semantics, one bridge artifact.
 *
 * Everything is project-local: every path joins onto the caller's
 * explicit `cwd` (the scope root); `$HOME` is never touched. No
 * console, no `process.*`: consent and reporting live with each
 * caller.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

import type {
  IActivityInstallEvent,
  IActivityInstallJsonHooks,
  IProvider,
} from '../../kernel/extensions/index.js';
import { readJsonObjectOrEmpty, writeJsonAtomic } from '../../kernel/util/atomic-write.js';
import {
  ACTIVITY_BRIDGE_REL,
  defaultActivityBridgePath,
  defaultProjectActivityDir,
} from '../paths/db-path.js';
import { readConfigValue, removeConfigValue, writeConfigValue } from '../config/helper.js';
import { ensureScopeGitignore } from '../scope-gitignore.js';
import { BRIDGE_PACKAGE_JSON, renderActivityBridge } from './bridge-template.js';
import {
  ACTIVITY_PLUGIN_MARKER,
  ACTIVITY_PLUGIN_PACKAGE_JSON,
  SHELL_ON_PLACEHOLDER,
  renderActivityPlugin,
} from './plugin-template.js';
import {
  DEFAULT_HOOKS_CONTAINER,
  hasActivityHooks,
  mergeActivityHooks,
  removeActivityHooks,
} from './hooks-merge.js';

/** Install-state probe result (see `activityInstallStatus`). */
export interface IActivityInstallStatus {
  /** The provider's hook config carries at least one bridge-marked entry. */
  configWired: boolean;
  /** The bridge script exists on disk. */
  bridgePresent: boolean;
  /** `configWired && bridgePresent`: both halves must hold to count as installed. */
  installed: boolean;
}

/**
 * Find a provider by id AMONG those declaring an activity adapter.
 * Callers pass whatever registry they own (the CLI passes built-ins,
 * the BFF passes built-ins + loaded drop-ins).
 */
export function findActivityProvider(
  providers: readonly IProvider[],
  id: string,
): IProvider | null {
  return providers.find((p) => p.id === id && p.activity !== undefined) ?? null;
}

/**
 * Derive the install state from disk. A half-installed state (config
 * wired but bridge hand-deleted, or the inverse) reports
 * `installed: false`; a fresh install repairs both halves. Never
 * throws: an unreadable / malformed config reads as not wired.
 */
export function activityInstallStatus(cwd: string, provider: IProvider): IActivityInstallStatus {
  const install = provider.activity?.install;
  if (install === undefined) {
    return { configWired: false, bridgePresent: false, installed: false };
  }
  if (install.kind === 'plugin-file') {
    // The plugin file IS both the wiring and the bridge: one artifact,
    // recognised by the skill-map header marker (a foreign file at the
    // same path is NOT ours and reads as not installed).
    const present = pluginFileIsOurs(join(cwd, install.configPath));
    return { configWired: present, bridgePresent: present, installed: present };
  }
  const settings = readJsonObjectOrEmpty(join(cwd, install.configPath));
  const configWired = hasActivityHooks(settings, ACTIVITY_BRIDGE_REL, containerOf(install));
  const bridgePresent = existsSync(defaultActivityBridgePath(cwd));
  return { configWired, bridgePresent, installed: configWired && bridgePresent };
}

/**
 * Full install sequence (the caller has already gated consent and
 * checked `install.kind === 'json-hooks'`): refresh the hook wiring in
 * the provider config, then (re)write the bridge artifact + its
 * CommonJS-pinning sibling `package.json`. The bridge is rewritten on
 * every install so a version upgrade refreshes the script. Throws on
 * IO failure (the caller reports it in its own vocabulary).
 */
export async function installActivityBridge(cwd: string, provider: IProvider): Promise<void> {
  const install = provider.activity!.install;
  if (install.kind === 'plugin-file') {
    // One self-contained artifact: the in-process plugin, the shared
    // envelope around the provider's own hook registrations. (Re)written
    // on every install so a version upgrade refreshes it; no hooks-file
    // merge and no spawned-bridge dir are involved.
    const hooksSource = provider.activity!.pluginHooksSource;
    if (hooksSource === undefined) {
      throw new Error(
        `provider "${provider.id}" declares a plugin-file install but no pluginHooksSource`,
      );
    }
    const pluginPath = join(cwd, install.configPath);
    const pluginDir = dirname(pluginPath);
    await mkdir(pluginDir, { recursive: true });
    // Shell opt-in (spec Capture level rung 5, plugin-file dialect):
    // the source's `{{SHELL_ON}}` placeholder resolves to the stored
    // key, so the wiring-level filter it parameterizes keeps the shell
    // tool's payloads inside the host process until the operator opts
    // in. Reading the key HERE mirrors the json-hooks branch below: a
    // bare re-install respects the stored choice.
    const pluginShellOn =
      readConfigValue<boolean>('activity.shellCapture', { cwd, default: false }) === true;
    await writeFile(
      pluginPath,
      renderActivityPlugin(provider.id, hooksSource, pluginShellOn),
      'utf8',
    );
    // Pin the plugin dir to ESM so the vendor's loader parses our
    // `export`-based plugin correctly regardless of the host project's
    // module type (see `ACTIVITY_PLUGIN_PACKAGE_JSON`). Written only when
    // absent: the dir is the vendor's territory (shared with its own
    // plugins), so a vendor-authored `package.json` is left untouched.
    const pkgPath = join(pluginDir, 'package.json');
    if (!existsSync(pkgPath)) {
      await writeFile(pkgPath, ACTIVITY_PLUGIN_PACKAGE_JSON, 'utf8');
    }
    return;
  }
  // Opt-in filter (spec provider-activity.md, Capture level rung 5): an
  // event marked `optIn: 'shell'` renders only while the project-local
  // `activity.shellCapture` key is on. Reading the key HERE (not a flag
  // threaded in) is what makes a bare re-install respect the stored
  // choice instead of silently dropping the rung on refresh.
  const shellOn =
    readConfigValue<boolean>('activity.shellCapture', { cwd, default: false }) === true;
  const events: readonly IActivityInstallEvent[] = (install.events ?? []).filter(
    (event) => event.optIn === undefined || (event.optIn === 'shell' && shellOn),
  );
  refreshHookWiring(join(cwd, install.configPath), events, bridgeCommand(provider.id, install), containerOf(install));

  const bridgePath = defaultActivityBridgePath(cwd);
  await mkdir(dirname(bridgePath), { recursive: true });
  await writeFile(bridgePath, renderActivityBridge(), 'utf8');
  await writeFile(join(dirname(bridgePath), 'package.json'), BRIDGE_PACKAGE_JSON, 'utf8');
  // The bridge is generated per machine and stamped with the CLI version
  // that wrote it, so it must never be committed (`provider-activity.md`
  // §Bridge contract, item 6). Top up the scope ignore file here rather
  // than trusting `sm init` to have listed `activity/`: a project
  // bootstrapped by an older CLI has an ignore file that predates the
  // entry, and this is the exact moment the directory appears on disk.
  ensureScopeGitignore(cwd);
}

/**
 * Exact reversal of `installActivityBridge`: remove the marked entries
 * (operator hooks untouched) and delete the `.skill-map/activity/` dir,
 * but ONLY when no OTHER `json-hooks` provider still references the
 * shared bridge (`providers` is the caller's full registry; see
 * `cli-contract.md` §Activity: "delete the bridge artifact when no
 * installed provider references it anymore"). Idempotent: `removed:
 * false` when nothing carried the marker, in which case NOTHING is
 * written or deleted (matching the CLI verb's no-op branch; a stray
 * bridge dir without config wiring stays put).
 */
export function uninstallActivityBridge(
  cwd: string,
  provider: IProvider,
  providers: readonly IProvider[],
): { removed: boolean } {
  const install = provider.activity!.install;
  // Revoking the whole capture surface revokes the sensitive rung with
  // it (spec provider-activity.md, Capture level rung 5): when THIS
  // provider owns the shell opt-in event, uninstall retires the key so
  // a later re-install starts relocked and only a fresh --shell
  // re-opens it. Runs regardless of `removed` (an uninstall on a
  // half-broken wiring must still drop the consent).
  if (providerOwnsShellOptIn(provider)) {
    retireShellOptIn(cwd);
  }
  const configPath = join(cwd, install.configPath);
  if (install.kind === 'plugin-file') {
    // Delete exactly our artifact; a foreign file at the same path
    // (no marker) is left untouched and reads as nothing-to-remove.
    // The shared bridge dir is never involved in this shape.
    if (!pluginFileIsOurs(configPath)) return { removed: false };
    rmSync(configPath, { force: true });
    removeOurPluginPackageJson(dirname(configPath));
    return { removed: true };
  }
  const settings = readJsonObjectOrEmpty(configPath);
  const changed = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL, containerOf(install));
  if (!changed) return { removed: false };
  writeJsonAtomic(configPath, settings);
  if (!otherJsonHooksProviderWired(cwd, provider, providers)) {
    rmSync(defaultProjectActivityDir(cwd), { recursive: true, force: true });
  }
  return { removed: true };
}

/**
 * Whether this Provider's install surface carries the shell opt-in
 * (spec provider-activity.md, Capture level rung 5): a `json-hooks`
 * descriptor with an `optIn: 'shell'` event, or a `plugin-file` hook
 * source parameterizing the `{{SHELL_ON}}` wiring filter. The single
 * predicate behind every shell-rung surface: the opt-in WRITERS (the
 * CLI `--shell`/`--no-shell` pair, the BFF `shellCapture` body field)
 * refuse a provider without it, so `activity.shellCapture` can only
 * ever be persisted from a provider whose uninstall path (below) also
 * knows how to retire it.
 */
export function providerOwnsShellOptIn(provider: IProvider): boolean {
  const activity = provider.activity;
  if (activity === undefined) return false;
  if (activity.install.kind === 'json-hooks') {
    return (activity.install.events ?? []).some((event) => event.optIn === 'shell');
  }
  return activity.pluginHooksSource?.includes(SHELL_ON_PLACEHOLDER) === true;
}

/**
 * Retire the shell opt-in: drop `activity.shellCapture` (and its
 * per-checkout grant) and demote a persisted `activity.captureLevel`
 * of `shell` back to the ladder default, so no config layer keeps
 * pointing at a rung the opt-in no longer backs. Shared by the
 * uninstall path here and the CLI / BFF `--no-shell` writers.
 */
export function retireShellOptIn(cwd: string): void {
  removeConfigValue('activity.shellCapture', { cwd, target: 'project-local' });
  demoteShellCaptureLevel(cwd);
}

/**
 * Half of the retirement usable on its own: writers that STORE `false`
 * (the `--no-shell` flag keeps an explicit off so a bare re-install
 * stays off) still need the level demotion.
 */
export function demoteShellCaptureLevel(cwd: string): void {
  const level = readConfigValue<string>('activity.captureLevel', { cwd, default: 'mcp' });
  if (level === 'shell') {
    writeConfigValue('activity.captureLevel', 'mcp', { cwd, target: 'project-local' });
  }
}

/**
 * Does any OTHER `json-hooks` provider still have its config wired to
 * the shared bridge? `.skill-map/activity/` holds ONE bridge serving
 * every hook-file provider, so only the LAST uninstall removes it;
 * earlier ones leave it in place (deleting it would break the survivors'
 * wiring: their configs spawn a script that no longer exists, and the
 * resulting non-zero node exit violates the bridge invisibility
 * invariants). Probed AFTER this provider's own wiring was removed, so
 * the uninstalling provider never counts itself.
 */
function otherJsonHooksProviderWired(
  cwd: string,
  uninstalling: IProvider,
  providers: readonly IProvider[],
): boolean {
  return providers.some(
    (p) =>
      p.id !== uninstalling.id &&
      p.activity?.install.kind === 'json-hooks' &&
      activityInstallStatus(cwd, p).configWired,
  );
}

/**
 * Remove the ESM-pinning `package.json` we wrote next to a plugin-file
 * install, IFF its content is EXACTLY ours. The plugin dir is the
 * vendor's territory, so a vendor-authored `package.json` (any other
 * content) is left in place. Best-effort: a missing / unreadable file is
 * a no-op, mirroring the install side, which writes it only when absent.
 */
function removeOurPluginPackageJson(pluginDir: string): void {
  const pkgPath = join(pluginDir, 'package.json');
  try {
    if (readFileSync(pkgPath, 'utf8') === ACTIVITY_PLUGIN_PACKAGE_JSON) {
      rmSync(pkgPath, { force: true });
    }
  } catch {
    // Absent / unreadable: nothing of ours to remove.
  }
}

/** The plugin file exists AND carries the skill-map header marker. */
function pluginFileIsOurs(pluginPath: string): boolean {
  try {
    return readFileSync(pluginPath, 'utf8').includes(ACTIVITY_PLUGIN_MARKER);
  } catch {
    return false;
  }
}

/**
 * Command the provider's hook config spawns per event:
 * `node <bridge> <provider>`.
 *
 * Three forms, in order of preference:
 *
 *   1. `install.projectDirEnvVar` declared: anchor on the runtime's
 *      project-root variable. Absolute at spawn time, so it does not
 *      care where the hook was spawned from, and still portable because
 *      no machine-specific path is written into a committed config.
 *   2. `commandCwd: 'config-dir'`: prefix the hops from
 *      `dirname(configPath)` back to the root (Antigravity spawns at the
 *      config's own directory).
 *   3. Default: the plain scope-relative path, for runtimes that spawn
 *      at the project root and expose no variable.
 *
 * Forms 2 and 3 depend on the spawn cwd, which is exactly the
 * assumption the bridge itself refuses to make (see
 * `bridge-template.ts`: "Never derive the scope from the spawn cwd").
 * That asymmetry was a real defect: the bridge distrusted the cwd for
 * everything after it loaded, while the command needed the cwd to load
 * it at all, so an agent that changed directory mid-session silently
 * stopped ingesting. Form 1 removes the asymmetry wherever a runtime
 * offers the variable; the others remain for runtimes that do not.
 *
 * Every form keeps the `ACTIVITY_BRIDGE_REL` substring, so the
 * ownership marker used by uninstall is unaffected.
 */
function bridgeCommand(providerId: string, install: IActivityInstallJsonHooks): string {
  return `node ${bridgeScriptPath(install)} ${providerId}`;
}

function bridgeScriptPath(install: IActivityInstallJsonHooks): string {
  if (install.projectDirEnvVar !== undefined) {
    // Quote the variable only, not the whole path: the runtime may
    // expand it to a directory containing spaces, and this keeps the
    // literal `ACTIVITY_BRIDGE_REL` substring intact for the marker.
    return `"$${install.projectDirEnvVar}"/${ACTIVITY_BRIDGE_REL}`;
  }
  if (install.commandCwd === 'config-dir') {
    return posix.join(posix.relative(posix.dirname(install.configPath), '.'), ACTIVITY_BRIDGE_REL);
  }
  return ACTIVITY_BRIDGE_REL;
}

/**
 * REFRESH semantics for the provider config: drop our marker-carrying
 * entries first, then re-add from the CURRENT descriptor. A plain
 * idempotency check would freeze stale entries in place (an older
 * install's event list / matchers would never pick up descriptor
 * changes); the remove+merge pair updates ours while leaving operator
 * hooks untouched either way. Persists only when something changed.
 */
function refreshHookWiring(
  configPath: string,
  events: readonly IActivityInstallEvent[],
  command: string,
  containerKey: string,
): void {
  const settings = readJsonObjectOrEmpty(configPath);
  const removedStale = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL, containerKey);
  const merge = mergeActivityHooks(settings, events, command, ACTIVITY_BRIDGE_REL, containerKey);
  if (removedStale || merge.changed) {
    writeJsonAtomic(configPath, settings);
  }
}

/**
 * Container key for the provider's hook document: the provider's OWNED
 * group (named-group shape, `install.group`) or the conventional
 * `hooks` key. See `hooks-merge.ts`.
 */
function containerOf(install: { group?: string }): string {
  return install.group ?? DEFAULT_HOOKS_CONTAINER;
}
