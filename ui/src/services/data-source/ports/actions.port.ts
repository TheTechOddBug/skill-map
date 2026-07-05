/**
 * `IActionsPort`, the sidecar-writing action surface: the legacy bump
 * endpoint and the generic action dispatch, both gated by the `.sm`
 * write-consent handshake. Mirrors `POST /api/sidecar/bump` and
 * `POST /api/actions/:qualifiedId`.
 *
 * One of the domain ports composed into `IDataSourcePort`
 * (`../data-source.port.ts`).
 */

import type {
  IActionAppliedEnvelopeApi,
  ISidecarBumpedEnvelopeApi,
} from '../../../models/api';

/**
 * Options for `bumpSidecar`. Mirrors `POST /api/sidecar/bump` body.
 */
export interface ISidecarBumpOpts {
  /**
   * Force the bump on a fresh node (silent no-op per the Action spec).
   * UI default is `false`, the bump button is disabled when the
   * overlay reports `fresh`.
   */
  force?: boolean;
  /**
   * Consent for `.sm` sidecar writes in this project. The BFF gates the
   * first `.sm` write behind `allowEditSmFiles` (default `false`); when
   * the flag is still `false` and `confirm` is omitted / `false`, the
   * server answers 412 with `code: 'confirm-required'`.
   */
  confirm?: boolean;
}

/**
 * Options for `dispatchAction`. Mirrors the `POST /api/actions/:qualifiedId`
 * body beyond the (required) `nodePath`.
 */
export interface IActionDispatchOpts {
  /**
   * Action-defined input bag (e.g. set-stability's target enum value).
   * Reserved for Steps 2+; the bump action ignores it. Passed verbatim
   * to the kernel Action's `invoke()`.
   */
  input?: unknown;
  /**
   * Consent for `.sm` sidecar writes in this project. When the
   * `allowEditSmFiles` flag is still `false` and `confirm` is omitted /
   * `false`, the BFF answers 412 `confirm-required`.
   */
  confirm?: boolean;
  /**
   * Persist the consent forever (flips the project-wide
   * `allowEditSmFiles` flag) instead of granting it for this one write.
   * Implies `confirm`. Only sent when the user ticked "always allow" in
   * the consent dialog.
   */
  always?: boolean;
}

export interface IActionsPort {
  /**
   * `POST /api/sidecar/bump`. Returns the success envelope on 200;
   * throws `DataSourceError` on any 4xx/5xx (the caller branches on
   * `code`). Demo mode rejects with `'demo-readonly'`.
   *
   * The success path does NOT update the in-memory node store directly
   *, the `sidecar.bumped` WS event broadcast by the BFF feeds the
   * `SidecarService` subscription that owns the patch, so the card
   * and inspector re-render via the same path the CLI / pre-commit
   * hook would trigger.
   */
  bumpSidecar(nodePath: string, opts?: ISidecarBumpOpts): Promise<ISidecarBumpedEnvelopeApi>;

  /**
   * `POST /api/actions/:qualifiedId`, the generic action-dispatch
   * endpoint. Resolves the kernel Action by qualified id (`core/node-bump`,
   * `core/node-set-stability`, ...), invokes it against `nodePath`, and
   * materialises any `.sm` writes through the consent gate. Returns the
   * success envelope on 200; throws `DataSourceError` on any 4xx/5xx so
   * the caller branches on `code`.
   *
   * Consent: the first `.sm` write in a project where `allowEditSmFiles`
   * is `false` answers 412 `code: 'confirm-required'` with
   * `details.key === 'allowEditSmFiles'`. The caller re-dispatches with
   * `{ confirm: true }` (one-shot) or `{ confirm: true, always: true }`
   * (persist) after the user accepts the consent dialog.
   *
   * The success path does NOT patch the in-memory node store directly,
   * the `action.applied` WS event broadcast by the BFF feeds the
   * loader's subscription so the card and inspector re-render via the
   * same path the CLI / pre-commit hook would trigger. Demo mode
   * rejects with `code: 'demo-readonly'`.
   */
  dispatchAction(
    actionId: string,
    nodePath: string,
    opts?: IActionDispatchOpts,
  ): Promise<IActionAppliedEnvelopeApi>;
}
