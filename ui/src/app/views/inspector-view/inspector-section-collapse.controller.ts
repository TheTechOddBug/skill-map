/**
 * Section-collapse controller for the inspector view (catalog curation
 * 2026-05-07).
 *
 * Owns the three collapsed-by-default signals (`auditExpanded`,
 * `pluginsExpanded`, `debugVisible`) and the reset effect that snaps
 * them back to closed on every `path` change so the next node opens
 * with the locked default surface (audit + plugins collapsed, debug
 * hidden).
 *
 * Mirrors the `inspector-bump-controller` / `inspector-body-state`
 * pattern: a `setupX` factory returns a typed handle the component
 * holds.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';

export interface ISectionCollapseConfig {
  path: Signal<string | undefined>;
}

export interface ISectionCollapseHandle {
  readonly auditExpanded: Signal<boolean>;
  readonly pluginsExpanded: Signal<boolean>;
  readonly debugVisible: Signal<boolean>;
  toggleAudit(): void;
  togglePlugins(): void;
  toggleDebug(): void;
}

export function setupSectionCollapse(
  config: ISectionCollapseConfig,
): ISectionCollapseHandle {
  // Reset effect below subscribes to `path`, so the helper must run in
  // an Angular injection context.
  assertInInjectionContext(setupSectionCollapse);

  const auditExpanded = signal<boolean>(false);
  const pluginsExpanded = signal<boolean>(false);
  const debugVisible = signal<boolean>(false);

  effect(() => {
    config.path();
    auditExpanded.set(false);
    pluginsExpanded.set(false);
    debugVisible.set(false);
  });

  return {
    auditExpanded: auditExpanded.asReadonly(),
    pluginsExpanded: pluginsExpanded.asReadonly(),
    debugVisible: debugVisible.asReadonly(),
    toggleAudit: () => auditExpanded.update((v) => !v),
    togglePlugins: () => pluginsExpanded.update((v) => !v),
    toggleDebug: () => debugVisible.update((v) => !v),
  };
}
