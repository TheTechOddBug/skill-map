/**
 * Enabled gate for DIRECT built-in extension use, outside the composed
 * catalogs (2026-07-21 sweep: "if the extension is disabled, it must not
 * work", user directive after the tag-row / dispatch-gate fix).
 *
 * Almost every execution surface goes through `composeScanExtensions` /
 * `buildActionRuntime`, which filter disabled extensions centrally. Two
 * paths deliberately bypass that composition for boot-cost reasons and
 * previously executed the raw bundled object, ignoring the toggle:
 *
 *   - `sm bump` (imports `nodeBumpAction` statically and invokes it),
 *   - the CLI entry's `boot` / `shutdown` hook dispatcher (dispatches
 *     `builtIns().hooks` without loading the plugin runtime).
 *
 * This helper closes both: it loads the project's layered config once
 * and answers the same question the composer asks
 * (`isBuiltInExtensionEnabled`), i.e. the live toggle over the
 * installed default derived from `stability` + `defaultEnabled`. Any
 * future surface that executes a built-in WITHOUT composing the runtime
 * must thread this same gate.
 */

import { loadConfig } from '../../kernel/config/loader.js';
import {
  installedDefaultEnabled,
  makeEnabledResolver,
} from '../../kernel/config/plugin-resolver.js';
import { lockedBuiltInIds } from '../../plugins/locked-built-ins.js';
import type { TExtensionStability } from '../../kernel/extensions/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';

/** The manifest fields the gate reads off a bundled built-in extension. */
export interface IBuiltInEnabledProbe {
  pluginId: string;
  id: string;
  stability?: TExtensionStability;
  defaultEnabled?: boolean;
}

/**
 * Build a predicate answering "is this bundled built-in enabled for the
 * project at `cwd`?" from ONE layered-config read. Use the factory when
 * gating a list (the boot hook dispatcher); use
 * `isBuiltInEnabledFor` for a single extension (`sm bump`).
 */
export function builtInEnabledResolverFor(
  cwd: string,
): (ext: IBuiltInEnabledProbe) => boolean {
  const resolveEnabled = makeEnabledResolver(loadConfig({ cwd }).effective, lockedBuiltInIds());
  return (ext) =>
    resolveEnabled(
      qualifiedExtensionId(ext.pluginId, ext.id),
      installedDefaultEnabled(ext.stability, ext.defaultEnabled),
    );
}

/** Single-extension form of `builtInEnabledResolverFor`. */
export function isBuiltInEnabledFor(cwd: string, ext: IBuiltInEnabledProbe): boolean {
  return builtInEnabledResolverFor(cwd)(ext);
}
