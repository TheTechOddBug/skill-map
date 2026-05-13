/**
 * Bump-button controller for the inspector view (Step 9.6.5).
 *
 * Owns the bump verb's full lifecycle:
 *   - `canBump`, derived from the active node's sidecar status.
 *   - `bumpInFlight` / `bumpError`, request state visible in the
 *     tooltip + error banner.
 *   - `onBumpClick`, calls `SidecarService.bump`. On the BFF's 412
 *     `confirm-required` answer, opens the consent dialog and (on
 *     accept) retries with `confirm: true`. Anything else surfaces as
 *     an error message via `formatBumpError`.
 *
 * Returned as a typed handle the component holds; the template binds
 * `canBump()` / `bumpInFlight()` / `bumpError()` / `bumpTooltip()` /
 * `onBumpClick()` / `dismissBumpError()` unchanged.
 */

import { assertInInjectionContext, computed, signal, type Signal } from '@angular/core';
import { ConfirmationService } from 'primeng/api';

import { INSPECTOR_VIEW_TEXTS } from '../../../i18n/inspector-view.texts';
import { isStaleSidecar, type INodeView } from '../../../models/node';
import { DataSourceError } from '../../../services/data-source/data-source.port';
import type { SidecarService } from '../../../services/sidecar';

export interface IBumpControllerConfig {
  node: Signal<INodeView | null | undefined>;
  sidecarService: SidecarService;
  confirmation: ConfirmationService;
}

export interface IBumpHandle {
  readonly canBump: Signal<boolean>;
  readonly bumpInFlight: Signal<boolean>;
  readonly bumpError: Signal<string | null>;
  readonly bumpTooltip: Signal<string>;
  onBumpClick: () => Promise<void>;
  dismissBumpError: () => void;
}

export function setupBumpController(config: IBumpControllerConfig): IBumpHandle {
  // Called from the component's field initializer (injection context).
  // The guard surfaces a misplaced call as a clear NG0203 with the
  // helper name in the stack, so future refactors that move the call
  // outside the constructor fail loudly instead of silently corrupting
  // signal ownership.
  assertInInjectionContext(setupBumpController);
  const { node: nodeSignal, sidecarService, confirmation } = config;
  const texts = INSPECTOR_VIEW_TEXTS;

  const canBump = computed<boolean>(() => {
    const n = nodeSignal();
    if (!n) return false;
    const overlay = n.sidecar;
    if (!overlay || overlay.present === false) return true;
    if (overlay.status === 'fresh') return false;
    return isStaleSidecar(overlay);
  });

  const bumpInFlight = signal<boolean>(false);
  const bumpError = signal<string | null>(null);

  const bumpTooltip = computed<string>(() => {
    if (!canBump()) return texts.bump.tooltipDisabledFresh;
    return texts.bump.tooltipEnabled;
  });

  const formatBumpError = (err: unknown): string => {
    if (err instanceof DataSourceError) {
      switch (err.code) {
        case 'sidecar-fresh':
          return `${texts.bump.errorPrefix} ${texts.bump.errorFresh}`;
        case 'not-found':
          return `${texts.bump.errorPrefix} ${texts.bump.errorNotFound}`;
        default:
          return `${texts.bump.errorPrefix} ${err.message || texts.bump.errorGeneric}`;
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return `${texts.bump.errorPrefix} ${message || texts.bump.errorGeneric}`;
  };

  /**
   * Retry the bump with `confirm: true` after the user accepted the
   * consent dialog. Surfaces the same error banner on any other
   * failure mode; on success the BFF emits the `sidecar.bumped` WS
   * event and the in-memory store updates via `SidecarService`'s
   * subscription.
   */
  const retryWithConsent = async (nodePath: string): Promise<void> => {
    if (bumpInFlight()) return;
    bumpInFlight.set(true);
    bumpError.set(null);
    try {
      await sidecarService.bump(nodePath, { confirm: true });
    } catch (err) {
      bumpError.set(formatBumpError(err));
    } finally {
      bumpInFlight.set(false);
    }
  };

  /**
   * Open the consent dialog for `.sm` sidecar writes. On accept, retry
   * the bump with `confirm: true`; the server flips the
   * `allowEditSmFiles` flag in `.skill-map/settings.local.json` and
   * proceeds. On reject, silently abandon, the user can re-click the
   * Bump button and they will be asked again. The flag is only
   * persisted on explicit accept (Decision 4 in the plan).
   */
  const openConsentDialog = (nodePath: string): void => {
    confirmation.confirm({
      header: texts.bump.consentHeader,
      message: texts.bump.consentMessage,
      acceptLabel: texts.bump.consentAccept,
      rejectLabel: texts.bump.consentReject,
      acceptButtonProps: { severity: 'primary' },
      rejectButtonProps: { severity: 'secondary' },
      accept: () => {
        void retryWithConsent(nodePath);
      },
    });
  };

  const onBumpClick = async (): Promise<void> => {
    const n = nodeSignal();
    if (!n) return;
    if (!canBump()) return;
    if (bumpInFlight()) return;
    bumpInFlight.set(true);
    bumpError.set(null);
    try {
      await sidecarService.bump(n.path);
    } catch (err) {
      // Phase 6 consent gate, the BFF answers 412 `confirm-required`
      // on the first `.sm` write in a project where `allowEditSmFiles`
      // is still `false`. Open the consent dialog; on accept, retry
      // with `confirm: true`. Reject is a silent abandon (matches the
      // precedent in `settings-project.ts` for `scan.extraFolders`).
      if (
        err instanceof DataSourceError &&
        err.code === 'confirm-required' &&
        consentDetailsTargetAllowEditSm(err.details)
      ) {
        openConsentDialog(n.path);
        return;
      }
      bumpError.set(formatBumpError(err));
    } finally {
      bumpInFlight.set(false);
    }
  };

  const dismissBumpError = (): void => {
    bumpError.set(null);
  };

  return {
    canBump,
    bumpInFlight: bumpInFlight.asReadonly(),
    bumpError: bumpError.asReadonly(),
    bumpTooltip,
    onBumpClick,
    dismissBumpError,
  };
}

/**
 * Narrows the `details` payload on a `confirm-required` error to the
 * `.sm` sidecar consent gate. The BFF embeds `{ key: 'allowEditSmFiles' }`
 * in `details` so the UI can branch on which copy to show (today
 * there are only two consent gates in flight, `scan.extraFolders`
 * and `allowEditSmFiles`, but more may land). Anything else falls
 * through to the generic error banner.
 */
function consentDetailsTargetAllowEditSm(details: unknown): boolean {
  if (typeof details !== 'object' || details === null) return false;
  const d = details as Record<string, unknown>;
  return d['key'] === 'allowEditSmFiles';
}
