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

import { existsSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { IActivityInstallEvent, IProvider } from '../../kernel/extensions/index.js';
import { readJsonObjectOrEmpty, writeJsonAtomic } from '../../kernel/util/atomic-write.js';
import {
  ACTIVITY_BRIDGE_REL,
  defaultActivityBridgePath,
  defaultProjectActivityDir,
} from '../paths/db-path.js';
import { BRIDGE_PACKAGE_JSON, renderActivityBridge } from './bridge-template.js';
import { hasActivityHooks, mergeActivityHooks, removeActivityHooks } from './hooks-merge.js';

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
  const settings = readJsonObjectOrEmpty(join(cwd, install.configPath));
  const configWired = hasActivityHooks(settings, ACTIVITY_BRIDGE_REL);
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
  const events: readonly IActivityInstallEvent[] = install.events ?? [];
  refreshHookWiring(join(cwd, install.configPath), events, provider.id);

  const bridgePath = defaultActivityBridgePath(cwd);
  await mkdir(dirname(bridgePath), { recursive: true });
  await writeFile(bridgePath, renderActivityBridge(), 'utf8');
  await writeFile(join(dirname(bridgePath), 'package.json'), BRIDGE_PACKAGE_JSON, 'utf8');
}

/**
 * Exact reversal of `installActivityBridge`: remove the marked entries
 * (operator hooks untouched) and delete the whole `.skill-map/activity/`
 * dir. Idempotent: `removed: false` when nothing carried the marker, in
 * which case NOTHING is written or deleted (matching the CLI verb's
 * no-op branch; a stray bridge dir without config wiring stays put).
 * v1 ships a single provider; when multi-provider installs land, the
 * dir removal becomes "only when no OTHER provider still references
 * the bridge".
 */
export function uninstallActivityBridge(cwd: string, provider: IProvider): { removed: boolean } {
  const install = provider.activity!.install;
  const configPath = join(cwd, install.configPath);
  const settings = readJsonObjectOrEmpty(configPath);
  const changed = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL);
  if (!changed) return { removed: false };
  writeJsonAtomic(configPath, settings);
  rmSync(defaultProjectActivityDir(cwd), { recursive: true, force: true });
  return { removed: true };
}

/** Command the provider's hook config spawns per event: `node <bridge> <provider>`. */
function bridgeCommand(providerId: string): string {
  return `node ${ACTIVITY_BRIDGE_REL} ${providerId}`;
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
  providerId: string,
): void {
  const settings = readJsonObjectOrEmpty(configPath);
  const removedStale = removeActivityHooks(settings, ACTIVITY_BRIDGE_REL);
  const merge = mergeActivityHooks(settings, events, bridgeCommand(providerId), ACTIVITY_BRIDGE_REL);
  if (removedStale || merge.changed) {
    writeJsonAtomic(configPath, settings);
  }
}
