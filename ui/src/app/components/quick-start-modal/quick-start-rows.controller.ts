/**
 * Row-machine factories for `<sm-quick-start-modal>`.
 *
 * The modal renders nine readiness rows sharing one vocabulary: a probed
 * or live status signal, a busy key in the modal's SINGLE pending set,
 * the ONE shared error banner, and an action handler. Before this file
 * every row hand-rolled that machinery longhand (with the 412 consent
 * block repeated three times over); the factories own the machinery once
 * and the component keeps only the per-row declarations (text mappings,
 * gates) plus template wiring.
 *
 * Mirrors the Settings `setupX` controller convention
 * (`plugin-state.controller.ts` et al): plain factories returning typed
 * handles the component holds. No DI and no `effect()` inside, so they
 * are safe to call from field initializers without an injection context.
 *
 * Three shapes cover the recurring machines:
 *   - `setupToggleRow`: rows whose owner is a live runtime service
 *     (Live updates / Real-time activity); the verdict derives from the
 *     owner's `enabled` signal plus an optional blocking gate.
 *   - `setupProbe`: fetch-into-signal envelope probes (project
 *     preferences, capture gate) that one OR MORE rows read; `null` =
 *     unknown (probe pending or failed).
 *   - `setupInstallRow`: probe + consent-gated install mutation (real-
 *     time hook, agent skill), built on the shared `runConfirmGated`
 *     412 runner.
 * The bespoke rows (MCP endpoint copy / check, the agent-jobs liveness
 * ping) keep their own machines in the component; the preference-PATCH
 * and capture writes share `runRowMutation` for busy + error
 * bookkeeping.
 */

import { computed, signal, type Signal } from '@angular/core';

import type { TQuickStartStatus } from '../../../i18n/quick-start.texts';
import { runConfirmGated } from '../confirm-gated';

/**
 * Machinery every row machine threads: the modal's single pending set
 * (one key per in-flight mutation, so the row's button disables), its
 * single error banner, and the promise-wrapped `ConfirmationService`
 * consent dialog. Built once by the component with arrow functions
 * closing over `this`, so handles created in field initializers can call
 * it safely later.
 */
export interface IRowMachineDeps {
  isPending(key: string): boolean;
  addPending(key: string): void;
  removePending(key: string): void;
  /** Write (or clear, with `null`) the shared error banner verbatim. */
  setError(message: string | null): void;
  /** Format an unknown failure (`formatErr`) onto the shared banner. */
  reportError(err: unknown): void;
  /** Present a consent dialog; resolve `true` on accept, `false` on dismiss. */
  confirmConsent(
    header: string,
    message: string,
    acceptLabel: string,
    rejectLabel: string,
  ): Promise<boolean>;
}

/**
 * Busy-key wrapper every mutation runner shares: refuse re-entry while
 * the key is pending, hold it for the WHOLE `body` (including any consent
 * dialog `body` awaits), and clear the shared banner up front. `body`
 * owns its error routing (the confirm-gated runners report through the
 * deps sink; bare writes catch + report inline). Returns the body's
 * result, or `undefined` when re-entry was refused.
 */
export async function runRowMutation<T>(
  deps: IRowMachineDeps,
  key: string,
  body: () => Promise<T>,
): Promise<T | undefined> {
  if (deps.isPending(key)) return undefined;
  deps.addPending(key);
  deps.setError(null);
  try {
    return await body();
  } finally {
    deps.removePending(key);
  }
}

// ===================================================================
// Toggle rows (runtime-owner flips, no probe, no consent).
// ===================================================================

export interface IToggleRowConfig {
  /** The feature OWNER's live enabled signal (never a local copy, so the
   *  row and the running behaviour cannot diverge). */
  enabled: Signal<boolean>;
  /** Flip the owner; it persists its own preference. */
  setEnabled(next: boolean): void;
  texts: { on: string; off: string; enable: string; disable: string };
  /** Optional gate: while `true` the row reads not-ready and ENABLING is
   *  refused (disabling stays allowed, a feature left on must always be
   *  stoppable). */
  blocked?: Signal<boolean>;
  /** Contextual hint shown while the gate blocks the row. */
  blockedHint?: string;
}

export interface IToggleRowHandle {
  /** The owner's enabled signal, re-exposed for template chrome
   *  (button severity / outlined track the current state). */
  readonly enabled: Signal<boolean>;
  readonly status: Signal<TQuickStartStatus>;
  readonly statusText: Signal<string>;
  readonly actionLabel: Signal<string>;
  /** Cannot ENABLE while the gate is unmet; disabling is always allowed. */
  readonly actionDisabled: Signal<boolean>;
  readonly meta: Signal<string | null>;
  toggle(): void;
}

export function setupToggleRow(cfg: IToggleRowConfig): IToggleRowHandle {
  const blocked = (): boolean => cfg.blocked?.() ?? false;
  return {
    enabled: cfg.enabled,
    // The gate folds into the INDICATOR (enabled but blocked is not
    // ready: nothing actually flows), while the status TEXT keeps
    // reporting the raw switch position.
    status: computed<TQuickStartStatus>(() =>
      cfg.enabled() && !blocked() ? 'ready' : 'not-ready',
    ),
    statusText: computed<string>(() => (cfg.enabled() ? cfg.texts.on : cfg.texts.off)),
    actionLabel: computed<string>(() =>
      cfg.enabled() ? cfg.texts.disable : cfg.texts.enable,
    ),
    actionDisabled: computed<boolean>(() => !cfg.enabled() && blocked()),
    meta: computed<string | null>(() =>
      blocked() && cfg.blockedHint !== undefined ? cfg.blockedHint : null,
    ),
    toggle: () => cfg.setEnabled(!cfg.enabled()),
  };
}

// ===================================================================
// Envelope probes (fetch-into-signal, shared by one or more rows).
// ===================================================================

export interface IProbeConfig<T> {
  fetch(): Promise<T>;
  /** Failure sink (usually `deps.reportError`); the value also resets to
   *  `null` so consumers fall back to their unknown state. */
  onError(err: unknown): void;
}

export interface IProbeHandle<T> {
  /** `null` = unknown (probe pending or failed). */
  readonly value: Signal<T | null>;
  /** Adopt a post-mutation response envelope without a re-fetch. */
  set(next: T | null): void;
  refresh(): Promise<void>;
}

export function setupProbe<T>(cfg: IProbeConfig<T>): IProbeHandle<T> {
  const value = signal<T | null>(null);
  return {
    value: value.asReadonly(),
    set: (next) => value.set(next),
    refresh: async () => {
      try {
        value.set(await cfg.fetch());
      } catch (err) {
        cfg.onError(err);
        value.set(null);
      }
    },
  };
}

// ===================================================================
// Install rows (probe + consent-gated mutation).
// ===================================================================

/** The slice of the install-status envelopes the machinery itself reads. */
export interface IInstallEnvelope {
  readonly supported: boolean;
  readonly installed: boolean;
}

export interface IInstallRowConfig<T extends IInstallEnvelope, TOp extends string> {
  deps: IRowMachineDeps;
  /** Busy key in the modal's pending set (also drives `busy`). */
  key: string;
  /** Snapshot the active lens at click time (mirrors the hand-rolled
   *  machines: the op targets the lens the user clicked under, even if
   *  the active lens changes mid-flight). */
  provider(): string;
  probe(provider: string): Promise<T>;
  /** Pick the operation from the envelope snapshotted at click time. */
  chooseOp(envelope: T): TOp;
  /** Fire one mutation POST and return its response envelope, which the
   *  machinery adopts as the row's new status. */
  dispatch(op: TOp, provider: string, confirm: boolean): Promise<T>;
  /** Post-adoption side effect (e.g. re-probing a shared readiness
   *  signal), sequenced AFTER the envelope lands. */
  afterDispatch?(): void;
  /**
   * Consent-dialog copy for the caught 412, built at dialog time so it
   * can name the exact target file/folder off the CURRENT envelope.
   */
  confirmCopy(
    op: TOp,
    envelope: T | null,
  ): { header: string; message: string; acceptLabel: string; rejectLabel: string };
}

export interface IInstallRowHandle<T> {
  /** Probed / adopted install-status envelope; `null` = unknown. */
  readonly status: Signal<T | null>;
  readonly busy: Signal<boolean>;
  refresh(provider: string): Promise<void>;
  /** The row's action: no-op while the status is unknown or the lens is
   *  unsupported (the button is disabled then anyway; this is the
   *  belt-and-braces guard the hand-rolled handlers carried). */
  run(): void;
}

export function setupInstallRow<T extends IInstallEnvelope, TOp extends string>(
  cfg: IInstallRowConfig<T, TOp>,
): IInstallRowHandle<T> {
  const status = signal<T | null>(null);

  const refresh = async (provider: string): Promise<void> => {
    try {
      status.set(await cfg.probe(provider));
    } catch (err) {
      cfg.deps.reportError(err);
      status.set(null);
    }
  };

  const run = (): void => {
    const envelope = status();
    if (envelope === null || !envelope.supported) return;
    const op = cfg.chooseOp(envelope);
    const provider = cfg.provider();
    // The pending key is held for the WHOLE flow, consent dialog
    // included, so the row's button stays disabled until the user
    // decides (the busy contract these rows always had).
    void runRowMutation(cfg.deps, cfg.key, () =>
      runConfirmGated({
        attempt: async (confirm) => {
          status.set(await cfg.dispatch(op, provider, confirm));
          cfg.afterDispatch?.();
        },
        confirm: () => {
          const copy = cfg.confirmCopy(op, status());
          return cfg.deps.confirmConsent(
            copy.header,
            copy.message,
            copy.acceptLabel,
            copy.rejectLabel,
          );
        },
        onError: (err) => cfg.deps.reportError(err),
      }),
    );
  };

  return {
    status: status.asReadonly(),
    busy: computed<boolean>(() => cfg.deps.isPending(cfg.key)),
    refresh,
    run,
  };
}
