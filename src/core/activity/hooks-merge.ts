/**
 * Non-destructive merge / removal of activity-bridge hook entries in a
 * provider's `json-hooks` config (`sm activity install|uninstall`, see
 * `spec/provider-activity.md` §CLI surface and the `json-hooks` install
 * shape).
 *
 * The target shape is the hooks convention Claude Code (and Codex)
 * document for their settings files:
 *
 *   { "hooks": { "<Event>": [ { "matcher"?: string,
 *                               "hooks": [{ "type": "command", "command": string }] } ] } }
 *
 * Normative behaviors:
 *
 *   - **Non-destructive**: pre-existing operator entries are preserved
 *     verbatim, ours are appended. Nothing else in the document is
 *     touched (the caller round-trips the full settings object).
 *   - **Marked for exact reversal**: every entry we add spawns the
 *     bridge, so its `command` CONTAINS the bridge's project-relative
 *     path. That substring IS the ownership marker: `remove` deletes
 *     exactly the entries carrying it and leaves everything else.
 *   - **Idempotent**: installing over an already-installed config
 *     changes nothing (matched by the same marker per event).
 *
 * Pure functions over parsed JSON (no filesystem): the verb owns IO via
 * `readJsonObjectOrEmpty` / `writeJsonAtomic`.
 */

import type { IActivityInstallEvent } from '../../kernel/extensions/index.js';

interface IHookCommand {
  type: 'command';
  command: string;
  [key: string]: unknown;
}

interface IHookEntry {
  matcher?: string;
  hooks: IHookCommand[];
  [key: string]: unknown;
}

export interface IMergeActivityHooksResult {
  /** `true` when the document was modified (caller persists only then). */
  changed: boolean;
  /** Events that already carried our marker and were left untouched. */
  alreadyWired: string[];
}

/**
 * Container key the per-event entry map lives under. Claude / Codex use
 * the vendor's fixed `hooks` key (operator entries coexist inside);
 * Antigravity's named-group document shape puts skill-map's entries
 * under an OWNED group key instead (`install.group`,
 * `spec/provider-activity.md` §capability). The inner shape is
 * identical, so every function here just parametrises the container.
 */
export const DEFAULT_HOOKS_CONTAINER = 'hooks';

/**
 * Wire `command` into every event of `events`, in place. Returns which
 * events were appended vs already wired so the verb can report
 * precisely.
 */
export function mergeActivityHooks(
  settings: Record<string, unknown>,
  events: readonly IActivityInstallEvent[],
  command: string,
  marker: string,
  containerKey: string = DEFAULT_HOOKS_CONTAINER,
): IMergeActivityHooksResult {
  const hooks = ensureObject(settings, containerKey);
  let changed = false;
  const alreadyWired: string[] = [];

  for (const spec of events) {
    const entries = ensureEntryArray(hooks, spec.event);
    // Wired-already probe per SPEC identity (event + matcher), not per
    // event name: a descriptor may carry two specs under one event with
    // different matchers (claude's base PreToolUse + the opt-in Bash
    // rung), and the first one merged must not swallow the second.
    if (
      entries.some(
        (entry) => entryCarriesMarker(entry, marker) && entry.matcher === spec.matcher,
      )
    ) {
      alreadyWired.push(spec.event);
      continue;
    }
    if (spec.entryShape === 'flat') {
      // Bare command entry (Antigravity lifecycle events); no matcher.
      entries.push({ type: 'command', command } as unknown as IHookEntry);
    } else {
      const entry: IHookEntry = {
        hooks: [{ type: 'command', command }],
      };
      if (spec.matcher !== undefined) entry.matcher = spec.matcher;
      entries.push(entry);
    }
    changed = true;
  }

  return { changed, alreadyWired };
}

/**
 * Read-only probe: does any hook entry in `settings` carry `marker`?
 * The install-status surfaces (`GET /api/activity/install`,
 * `sm activity status`) derive "config is wired" from this without
 * cloning or mutating the parsed document.
 */
export function hasActivityHooks(
  settings: Record<string, unknown>,
  marker: string,
  containerKey: string = DEFAULT_HOOKS_CONTAINER,
): boolean {
  const hooks = readHooksRecord(settings, containerKey);
  if (hooks === null) return false;
  for (const value of Object.values(hooks)) {
    if (!Array.isArray(value)) continue;
    if (value.some((entry) => isHookEntry(entry) && entryCarriesMarker(entry, marker))) {
      return true;
    }
  }
  return false;
}

/**
 * Remove every entry whose command carries `marker`, in place. Empty
 * event arrays (and an empty `hooks` object) left behind by the removal
 * are pruned so an install/uninstall round-trip restores the original
 * document byte-shape. Returns `true` when anything was removed.
 */
export function removeActivityHooks(
  settings: Record<string, unknown>,
  marker: string,
  containerKey: string = DEFAULT_HOOKS_CONTAINER,
): boolean {
  const hooks = readHooksRecord(settings, containerKey);
  if (hooks === null) return false;

  let changed = false;
  for (const [event, value] of Object.entries(hooks)) {
    changed = pruneEventEntries(hooks, event, value, marker) || changed;
  }

  if (changed && Object.keys(hooks).length === 0) {
    delete settings[containerKey];
  }
  return changed;
}

function readHooksRecord(
  settings: Record<string, unknown>,
  containerKey: string,
): Record<string, unknown> | null {
  const hooks = settings[containerKey];
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return null;
  return hooks as Record<string, unknown>;
}

/** Drop marker-carrying entries from one event array; prune it when emptied. */
function pruneEventEntries(
  hooks: Record<string, unknown>,
  event: string,
  value: unknown,
  marker: string,
): boolean {
  if (!Array.isArray(value)) return false;
  const kept = value.filter((entry) => !isHookEntry(entry) || !entryCarriesMarker(entry, marker));
  if (kept.length === value.length) return false;
  if (kept.length === 0) {
    delete hooks[event];
  } else {
    hooks[event] = kept;
  }
  return true;
}

function entryCarriesMarker(entry: IHookEntry, marker: string): boolean {
  // Flat command entry (Antigravity lifecycle events): the entry IS the
  // command object.
  if (typeof entry['command'] === 'string') {
    return (entry['command'] as string).includes(marker);
  }
  return (
    Array.isArray(entry.hooks) &&
    entry.hooks.some((hook) => typeof hook.command === 'string' && hook.command.includes(marker))
  );
}

function isHookEntry(value: unknown): value is IHookEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const shaped = value as Record<string, unknown>;
  // Wrapped matcher-group entry OR flat command entry.
  return Array.isArray(shaped['hooks']) || typeof shaped['command'] === 'string';
}

/**
 * Get-or-create a plain-object child key. A pre-existing NON-object
 * value throws instead of being replaced: silently clobbering a foreign
 * shape would violate the non-destructive contract, the verb surfaces
 * the error and leaves the file untouched.
 */
function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing === undefined) {
    const created: Record<string, unknown> = {};
    parent[key] = created;
    return created;
  }
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
    throw new Error(`settings key "${key}" is not an object; refusing to overwrite it`);
  }
  return existing as Record<string, unknown>;
}

function ensureEntryArray(hooks: Record<string, unknown>, event: string): IHookEntry[] {
  const existing = hooks[event];
  if (existing === undefined) {
    const created: IHookEntry[] = [];
    hooks[event] = created;
    return created;
  }
  if (!Array.isArray(existing)) {
    throw new Error(`hooks event "${event}" is not an array; refusing to overwrite it`);
  }
  return existing as IHookEntry[];
}
