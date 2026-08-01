/**
 * Coordination point between the Settings modal chassis and every
 * sub-surface that owns a buffered-edit area. Today two owner SHAPES
 * register here:
 *
 *   - the Plugins panel (`SettingsPlugins`), whose buffer holds the
 *     per-extension enable/disable toggle deltas.
 *   - each per-plugin section (`SettingsPluginSection`), one owner per
 *     plugin that declares operator settings, whose buffer holds the
 *     option-form edits for that plugin's extensions.
 *
 * The chassis needs two things from the union of those buffers: the
 * aggregate dirty count (to gate the close-confirm dialog and show the
 * global footer) and a SINGLE global Apply that commits every owner's
 * pending edits in one atomic bulk PATCH. Both belong here rather than on
 * any one panel: no panel can see the others' dirty state, and a per-panel
 * Apply would fan out into N PATCHes instead of the one the BFF contract
 * wants.
 *
 * Multi-owner model: owners live in a `Set`. `dirtyCount` sums every
 * owner's `dirtyIds().size`. `applyChanges()` merges every owner's
 * `collectChanges()` into one `IPluginChange[]` and issues ONE
 * `applyPluginChanges(changes)`; on success it reseeds every owner from
 * the response, fires a scan, and resolves `{ ok: true }` so the chassis
 * closes the modal. On error it surfaces the message via `applyError` and
 * leaves every buffer dirty so the user can retry or discard.
 *
 * Lifecycle: `providedIn: 'root'` because only one Settings modal can be
 * open at a time. Each owner registers on construction and deregisters
 * on its `DestroyRef`, so a second open of the modal never sees a stale
 * owner.
 */

import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import type {
  IPluginItemApi,
  IListEnvelopeApi,
} from '../../../models/api';
import {
  DATA_SOURCE,
  DataSourceError,
  type IPluginChange,
  type TPluginItem,
} from '../../../services/data-source/data-source.port';
import { ScanTriggerService } from '../../services/scan-trigger';

/**
 * Contract every buffered sub-surface implements to participate in the
 * global Apply. The service only ever observes `dirtyIds` reactively and
 * invokes the three imperative methods; no other surface leaks across the
 * boundary.
 */
export interface IBufferOwner {
  /** Set of dirty ids this owner holds; size feeds `dirtyCount`. */
  dirtyIds: Signal<ReadonlySet<string>>;
  /**
   * Project the owner's dirty rows into bulk-PATCH change entries
   * (`{ id, enabled?, settings? }`). Returns `[]` when nothing is dirty.
   * MUST NOT issue any request; the service merges every owner's output
   * into the one PATCH.
   */
  collectChanges(): IPluginChange[];
  /**
   * Re-seed the owner's snapshot + editable buffer from the post-write
   * plugin list so its dirty markers clear after a successful global
   * Apply. Each owner picks out the rows it cares about.
   */
  reseed(plugins: readonly IPluginItemApi[]): void;
  /** Drop all pending edits back to the last-seeded snapshot. */
  discardChanges(): void;
  /**
   * Optional "restart `sm serve`" advisory: `true` when this owner has a
   * pending edit whose effect needs a server restart (today only the
   * Plugins panel re-enabling a `startsAsDisabled` plugin). The chassis
   * footer ORs every owner's flag into a single hint next to Apply.
   * Owners with no such concern omit it.
   */
  restartRecommended?: Signal<boolean>;
}

@Injectable({ providedIn: 'root' })
export class SettingsBufferService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly scanTrigger = inject(ScanTriggerService);

  /**
   * Registered owners. A `Set` so re-registration is idempotent and
   * deregistration is an O(1) delete; ordering does not matter because
   * the merged change list is keyed by id and the BFF dispatches per id.
   */
  private readonly owners = signal<ReadonlySet<IBufferOwner>>(new Set());

  /** True while the global Apply is awaiting the bulk PATCH + scan. */
  private readonly applyingSig = signal(false);
  readonly applying = this.applyingSig.asReadonly();

  /** Last global-Apply error, or `null` after a success / reset. The
   *  chassis renders it inline next to the footer; cleared on the next
   *  apply attempt and on `discardChanges`. */
  private readonly applyErrorSig = signal<string | null>(null);
  readonly applyError = this.applyErrorSig.asReadonly();

  /** Aggregate count of dirty ids across every registered owner. Zero
   *  when no owner is dirty (or none registered). Drives the global
   *  footer's visibility + the close-confirm copy. */
  readonly dirtyCount = computed<number>(() => {
    let total = 0;
    for (const owner of this.owners()) total += owner.dirtyIds().size;
    return total;
  });

  /** True when any registered owner advises a server restart for its
   *  pending edits to take effect (today: the Plugins panel re-enabling a
   *  `startsAsDisabled` plugin). Drives the chassis footer's restart
   *  hint, ORed across owners. */
  readonly restartRecommended = computed<boolean>(() => {
    for (const owner of this.owners()) {
      if (owner.restartRecommended?.() === true) return true;
    }
    return false;
  });

  /**
   * Register a buffered owner. Idempotent: re-registering the same
   * instance is a no-op. A fresh `Set` is published so the `dirtyCount`
   * computed re-tracks the new membership.
   */
  register(owner: IBufferOwner): void {
    if (this.owners().has(owner)) return;
    const next = new Set(this.owners());
    next.add(owner);
    this.owners.set(next);
  }

  /**
   * Deregister the given owner (called from its `DestroyRef`). No-op
   * when the owner was never registered.
   */
  deregister(owner: IBufferOwner): void {
    if (!this.owners().has(owner)) return;
    const next = new Set(this.owners());
    next.delete(owner);
    this.owners.set(next);
  }

  /**
   * Commit every owner's pending edits in ONE atomic bulk PATCH.
   *
   * Flow:
   *   1. Merge every owner's `collectChanges()` into one
   *      `IPluginChange[]`. Resolve `{ ok: false }` when the merged list
   *      is empty (nothing dirty), the chassis never calls this without a
   *      positive `dirtyCount` so that branch is defensive.
   *   2. Issue `applyPluginChanges(merged)`. The BFF applies all-or-
   *      nothing; a single bad entry rejects the whole batch.
   *   3. On success: reseed every owner from the response, fire a scan so
   *      the graph reflects the new state, resolve `{ ok: true }` so the
   *      chassis closes the modal.
   *   4. On error: surface the message via `applyError`, leave every
   *      buffer dirty, resolve `{ ok: false }` so the modal stays open.
   */
  async applyChanges(): Promise<{ ok: boolean }> {
    if (this.applyingSig()) return { ok: false };
    const merged = this.collectAllChanges();
    if (merged.length === 0) return { ok: false };

    this.applyingSig.set(true);
    this.applyErrorSig.set(null);
    let envelope: IListEnvelopeApi<TPluginItem> | null = null;
    try {
      envelope = await this.dataSource.applyPluginChanges(merged);
    } catch (err) {
      this.applyErrorSig.set(formatApplyError(err));
      this.applyingSig.set(false);
      return { ok: false };
    }
    this.applyingSig.set(false);

    // Reseed every owner from the post-write list so dirty markers clear
    // (applied toggles + values become the new snapshot, secrets re-blank).
    for (const owner of this.owners()) owner.reseed(envelope.items);
    // Fire a scan so the graph picks up the new contribution set. The
    // trigger service guards concurrent runs and owns the topbar spinner.
    void this.scanTrigger.run();
    return { ok: true };
  }

  /** Drop pending edits in every registered owner and clear the error. */
  discardChanges(): void {
    for (const owner of this.owners()) owner.discardChanges();
    this.applyErrorSig.set(null);
  }

  /** Merge every owner's dirty change entries into one list (keyed by id
   *  on the BFF side; owners never share an id so no merge collision). */
  private collectAllChanges(): IPluginChange[] {
    const merged: IPluginChange[] = [];
    for (const owner of this.owners()) merged.push(...owner.collectChanges());
    return merged;
  }
}

function formatApplyError(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
