/**
 * Coordination point between the Settings modal chassis and whichever
 * sub-panel owns a buffered-edit surface (today: only `SettingsPlugins`).
 * The chassis needs to know "is there a dirty buffer right now?" so the
 * close-confirm dialog can intercept the modal-close, but the dirty
 * state itself logically belongs to the panel that produces the edits.
 *
 * Before this service the chassis read the panel via
 * `viewChild(SettingsPlugins)` and dereferenced `panel?.dirtyIds().size`
 * directly, which coupled the chassis to the panel's class name plus
 * the rename / extract of its dirty surface. Now the panel registers
 * an `IBufferOwner` on construction; the chassis reads the same
 * reactive count through this service.
 *
 * Lifecycle: `providedIn: 'root'` because only one Settings modal can
 * be open at a time. The panel deregisters itself on destroy so a
 * second open of the modal does not see a stale owner. `register()`
 * returns void; deregistration is automatic via the panel's
 * `DestroyRef`.
 */

import { Injectable, Signal, computed, signal } from '@angular/core';

/**
 * Contract any buffered sub-panel must implement to participate in the
 * close-confirm dance. The chassis only ever observes `dirtyIds.size`
 * reactively + invokes the two imperative methods, no other surface
 * leaks across the boundary.
 */
export interface IBufferOwner {
  /** Set of dirty IDs the buffer holds; size drives `dirtyCount`. */
  dirtyIds: Signal<ReadonlySet<string>>;
  /** Commit the buffer; returns whether the apply succeeded. */
  applyChanges(): Promise<{ ok: boolean }>;
  /** Drop all pending edits back to the last-loaded snapshot. */
  discardChanges(): void;
}

@Injectable({ providedIn: 'root' })
export class SettingsBufferService {
  private readonly ownerSig = signal<IBufferOwner | null>(null);

  /** Reactive count of dirty IDs. Zero when no owner is registered. */
  readonly dirtyCount = computed<number>(() => {
    const owner = this.ownerSig();
    return owner ? owner.dirtyIds().size : 0;
  });

  /**
   * Register the currently-active buffered owner. Idempotent: a second
   * `register` overwrites the previous reference (the modal opens at
   * most one buffered sub-panel at a time today, but the contract stays
   * lenient so a future second buffered panel does not have to fight
   * for the slot).
   */
  register(owner: IBufferOwner): void {
    this.ownerSig.set(owner);
  }

  /**
   * Deregister the given owner. No-op when the registered owner is a
   * different instance (covers the late-destroy race where a second
   * panel registered before the first tore down). The panel calls this
   * on `DestroyRef.onDestroy()`.
   */
  deregister(owner: IBufferOwner): void {
    if (this.ownerSig() === owner) this.ownerSig.set(null);
  }

  /**
   * Commit the registered buffer. Resolves to `{ ok: false }` when no
   * owner is registered (defensive, the chassis never calls this path
   * without a positive `dirtyCount` so the branch is unreachable in
   * normal flow).
   */
  async applyChanges(): Promise<{ ok: boolean }> {
    const owner = this.ownerSig();
    if (!owner) return { ok: false };
    return owner.applyChanges();
  }

  /** Drop pending edits in the registered buffer. No-op when none registered. */
  discardChanges(): void {
    this.ownerSig()?.discardChanges();
  }
}
