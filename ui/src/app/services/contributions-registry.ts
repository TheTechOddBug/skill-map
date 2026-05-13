/**
 * `ContributionsRegistryService`, holds the active contributions
 * registry (mirror of the BFF's `IContributionsRegistry`) so renderer
 * components can look up the manifest-declared `label` / `tooltip` /
 * `icon` / `emptyText` / `emitWhenEmpty` for a contribution by its
 * qualified id.
 *
 * The registry is updated:
 *   - At app boot via `GET /api/contributions/registered` (one-time
 *     fetch, cached).
 *   - Whenever a payload-bearing envelope arrives carrying a
 *     `contributionsRegistry` field, the data-source layer calls
 *     `setRegistry(envelope.contributionsRegistry)` after each fetch
 *     so the UI tracks plugin enable/disable transitions without a
 *     dedicated invalidation event.
 *
 * Reads are O(1) lookups against the in-memory map.
 */

import { Injectable, signal } from '@angular/core';

import type { IContributionsRegistryApi, IContributionsRegistryEntryApi } from '../../models/api';

@Injectable({ providedIn: 'root' })
export class ContributionsRegistryService {
  private readonly registry = signal<IContributionsRegistryApi>({});

  /**
   * Replace the cached registry. Called by the data-source layer
   * after every payload-bearing fetch and once on boot from
   * `/api/contributions/registered`.
   */
  setRegistry(next: IContributionsRegistryApi | undefined): void {
    if (!next) return;
    this.registry.set(next);
  }

  /**
   * Lookup by qualified id `<pluginId>/<extensionId>/<contributionId>`.
   * Returns `undefined` when the registry has not yet been populated
   * or when the contribution was not declared in any loaded plugin's
   * manifest (deprecated slot, plugin disabled between scans).
   * Renderer components fall back to their built-in defaults in that
   * case.
   */
  get(qualifiedId: string): IContributionsRegistryEntryApi | undefined {
    return this.registry()[qualifiedId];
  }

  /** Read the full registry, used by the inspector audit/debug panels. */
  all(): IContributionsRegistryApi {
    return this.registry();
  }
}
