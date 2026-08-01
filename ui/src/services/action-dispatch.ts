/**
 * `ActionDispatchService`, the UI half of the generic action-dispatch
 * flow. Generalises the retired `inspector-bump-controller.ts`: instead
 * of owning the bump verb alone, it dispatches ANY kernel Action by
 * qualified id against a node path, and shares the `.sm` write-consent
 * handshake across every action.
 *
 * Lifecycle of `dispatch(actionId, nodePath, input?)`:
 *   1. POST `/api/actions/:qualifiedId` via the data-source port.
 *   2. On success, resolve. The in-memory node store updates through the
 *      BFF's `action.applied` WS broadcast, not a manual patch here, so
 *      the card and inspector re-render via the same path the CLI /
 *      pre-commit hook would.
 *   3. On a 412 `confirm-required` whose `details.key === 'allowEditSmFiles'`,
 *      open the consent dialog (`consentOpen()` flips true). The pending
 *      dispatch is parked until the user answers via `resolveConsent()`:
 *        - accept, not "always": retry with `{ confirm: true }`.
 *        - accept + "always": retry with `{ confirm: true, always: true }`.
 *        - decline: silent abandon (no error banner), matching the
 *          `settings-project.ts` precedent for `scan.referencePaths`.
 *   4. Any other error surfaces via `error()` (a formatted message).
 *
 * The service is presentational-state only; the consent DIALOG is a
 * separate component (`<sm-sidecar-consent-dialog>`) driven by
 * `consentOpen()` and reporting back through `resolveConsent()`. This
 * keeps the dispatch logic free of PrimeNG imports and unit-testable
 * without a TestBed.
 *
 * Demo mode: `dispatchAction()` rejects with `'demo-readonly'`, which
 * surfaces in `error()` like any other failure; the service stays inert
 * by virtue of the rejection.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { ACTION_DISPATCH_TEXTS } from '../i18n/action-dispatch.texts';
import {
  DATA_SOURCE,
  DataSourceError,
  type IDataSourcePort,
} from './data-source/data-source.port';

/** Consent flags a parked retry receives when the user accepts. */
export interface ISmConsentGrant {
  confirm: true;
  always?: true;
}

@Injectable({ providedIn: 'root' })
export class ActionDispatchService {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);
  private readonly texts = ACTION_DISPATCH_TEXTS;

  private readonly inFlightSig = signal<boolean>(false);
  private readonly errorSig = signal<string | null>(null);
  private readonly consentOpenSig = signal<boolean>(false);

  /** A dispatch round-trip is in flight (button shows a spinner). */
  readonly inFlight = this.inFlightSig.asReadonly();
  /** Formatted last-error message, or null. Bound to the error banner. */
  readonly error = this.errorSig.asReadonly();
  /** Drives the `<sm-sidecar-consent-dialog>` `open` input. */
  readonly consentOpen = this.consentOpenSig.asReadonly();
  /** True when an action is dispatchable (idle). Convenience for callers. */
  readonly idle = computed(() => !this.inFlightSig());

  /**
   * The retry parked behind the consent dialog, if any. A CALLBACK, not
   * an action tuple: any `.sm`-writing flow (the action dispatch below,
   * the findings dismiss / undismiss) parks its own retry through
   * `requestSmConsent`, so ONE dialog instance serves every flow.
   */
  private pending: ((consent: ISmConsentGrant) => void) | null = null;

  /**
   * Dispatch a kernel Action against `nodePath`. Resolves on success;
   * on a `.sm` consent gate it opens the dialog and resolves once the
   * user has answered (the retry, if accepted, runs before resolve).
   * Any non-consent failure is captured in `error()` and the promise
   * still resolves (callers do not need to try/catch, they read state).
   */
  async dispatch(actionId: string, nodePath: string, input?: unknown): Promise<void> {
    if (this.inFlightSig()) return;
    this.errorSig.set(null);
    await this.run(actionId, nodePath, input, {});
  }

  /**
   * Park a retry behind the shared consent dialog and open it. Callers
   * (e.g. the findings dismiss / undismiss flow) invoke this when their
   * OWN request hit the `.sm` consent gate (`isSmConsentRequired`); the
   * callback fires with the granted flags when the user accepts, and is
   * silently dropped on decline.
   */
  requestSmConsent(retry: (consent: ISmConsentGrant) => void): void {
    this.pending = retry;
    this.consentOpenSig.set(true);
  }

  /**
   * Resolve the consent dialog. Called by the host when the
   * `<sm-sidecar-consent-dialog>` emits its `decision`. Accept invokes
   * the parked retry with the right consent flags; decline abandons it
   * silently.
   */
  resolveConsent(decision: { accepted: boolean; always: boolean }): void {
    this.consentOpenSig.set(false);
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (!decision.accepted) return; // silent abandon
    pending(decision.always ? { confirm: true, always: true } : { confirm: true });
  }

  /** Dismiss the error banner. */
  dismissError(): void {
    this.errorSig.set(null);
  }

  /**
   * Single dispatch attempt. `consent` is `{}` on the first try and
   * `{ confirm }` / `{ confirm, always }` on a post-consent retry.
   */
  private async run(
    actionId: string,
    nodePath: string,
    input: unknown,
    consent: { confirm?: boolean; always?: boolean },
  ): Promise<void> {
    this.inFlightSig.set(true);
    try {
      await this.dataSource.dispatchAction(actionId, nodePath, { input, ...consent });
    } catch (err) {
      // First-write consent gate: 412 `confirm-required` with the
      // `allowEditSmFiles` key. Park the dispatch and open the dialog;
      // the retry (or abandon) runs from `resolveConsent`. Only the
      // FIRST attempt can hit this (the retry already carries consent),
      // so there is no risk of re-opening the dialog in a loop.
      if (consent.confirm !== true && isSmConsentRequired(err)) {
        this.requestSmConsent((grant) => void this.run(actionId, nodePath, input, grant));
        return;
      }
      this.errorSig.set(this.formatError(err));
    } finally {
      this.inFlightSig.set(false);
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof DataSourceError) {
      switch (err.code) {
        case 'fresh':
          return `${this.texts.errorPrefix} ${this.texts.errorFresh}`;
        case 'not-found':
          return `${this.texts.errorPrefix} ${this.texts.errorNotFound}`;
        case 'demo-readonly':
          return `${this.texts.errorPrefix} ${this.texts.errorReadonly}`;
        default:
          return `${this.texts.errorPrefix} ${err.message || this.texts.errorGeneric}`;
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return `${this.texts.errorPrefix} ${message || this.texts.errorGeneric}`;
  }
}

/**
 * True when `err` is the `.sm` sidecar consent gate: a 412
 * `confirm-required` `DataSourceError` whose `details` carry
 * `{ key: 'allowEditSmFiles' }` (the BFF embeds the key so the UI
 * branches on which copy to show; there are two consent gates today,
 * `scan.referencePaths` and `allowEditSmFiles`). Shared by the action
 * dispatch above and every other `.sm`-writing flow (findings dismiss /
 * undismiss) that parks a retry via `requestSmConsent`.
 */
export function isSmConsentRequired(err: unknown): boolean {
  return (
    err instanceof DataSourceError &&
    err.code === 'confirm-required' &&
    consentTargetsAllowEditSm(err.details)
  );
}

/** Narrows the `details` payload to the `allowEditSmFiles` gate. */
function consentTargetsAllowEditSm(details: unknown): boolean {
  if (typeof details !== 'object' || details === null) return false;
  const d = details as Record<string, unknown>;
  return d['key'] === 'allowEditSmFiles';
}
