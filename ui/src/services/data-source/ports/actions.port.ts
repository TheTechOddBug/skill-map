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
  IJobSubmittedEnvelopeApi,
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

  /**
   * `POST /api/nodes/:pathB64/jobs` (Step 16 piece 1), enqueue a
   * probabilistic extension against one node from the inspector's
   * launcher buttons. Goes through the SAME shared submit machinery as
   * `sm jobs submit` on the BFF side, so every submit rule is inherited
   * (duplicate refusal, fixer findings injection, supersede, drift
   * verification). Returns the `job.submitted` envelope on 200; throws
   * `DataSourceError` on any 4xx/5xx so the caller branches on `code`:
   *
   *   - `no-processing-agent` (409): the operator gate, no processing
   *     skill installed. The UI renders the advisory plus an
   *     `sm agent install` hint.
   *   - `duplicate-job` (409): an active identical job already exists
   *     (`details.existingId`); the UI treats it as already queued.
   *   - `job-running` / `no-findings` / `node-drifted` (409),
   *     `bad-query` (400), `not-found` (404): surfaced verbatim.
   *
   * The success path does NOT patch local state beyond the optimistic
   * `queued` flip; the `job.submitted` WS broadcast confirms for every
   * connected client. Demo mode rejects with `'demo-readonly'`.
   *
   * `autoFix` (default `false`) rides the POST body as `autoFix`: on a
   * finder submit it freezes `state_jobs.auto_fix` so the record path
   * chains the finder's fixers on completion (the inspector's automatic
   * toggle sends it). Ignored by the kernel on a non-finder target.
   */
  submitNodeJob(
    nodePath: string,
    extensionId: string,
    autoFix?: boolean,
  ): Promise<IJobSubmittedEnvelopeApi>;

  /**
   * `POST /api/jobs/:jobId/cancel` (Step 16, launcher stop), cancel an
   * active queued/running job by id, the HTTP face of `sm jobs cancel`.
   * Resolves on `204 No Content`; throws `DataSourceError` on any
   * 4xx/5xx so the caller branches on `code`:
   *
   *   - `job-terminal` (409): the job already reached a terminal state
   *     (completed / failed / cancelled). NOT an error worth surfacing,
   *     the job simply finished in the race; the launcher just
   *     re-fetches the authoritative state.
   *   - `not-found` (404): unknown job id (or missing DB).
   *
   * The success path does NOT patch local state beyond the caller's
   * optimistic `idle` flip; the `job.cancelled` WS broadcast (and the
   * debounced re-fetch it triggers) confirms for every connected
   * client. Demo mode rejects with `'demo-readonly'`.
   */
  cancelJob(jobId: string): Promise<void>;

  /**
   * `POST /api/jobs/cancel-all`, cancel EVERY active (queued/running) job
   * in one transaction, the HTTP face of `sm jobs cancel --all`. Resolves
   * on `204` (a per-id `job.cancelled` broadcast fans out; the caller
   * re-fetches). Demo mode rejects with `'demo-readonly'`.
   */
  cancelAllJobs(): Promise<void>;

  /**
   * `POST /api/nodes/:pathB64/findings/:id/dismiss`, the inspector's
   * per-finding X (the read-time suppression lens: the class HIDES, rows
   * kept, reversible). A sidecar write behind the `.sm` consent gate:
   * without a standing grant the BFF answers `412` `confirm-required`
   * (`details.key = 'allowEditSmFiles'`), surfaced as a `DataSourceError`
   * the consent dialog answers by retrying with `confirm` / `always`.
   * Kernel safety rows refuse with `'finding-not-dismissible'` (409);
   * unknown id `'not-found'` (404). Resolves on `204`; the caller
   * re-fetches (no WS frame fires). Demo rejects `'demo-readonly'`.
   */
  dismissFinding(
    nodePath: string,
    findingId: number,
    opts?: { confirm?: boolean; always?: boolean },
  ): Promise<void>;

  /**
   * `POST /api/nodes/:pathB64/findings/:id/resolve`, mark a finding fixed
   * by the OPERATOR (`resolution = 'fixed'`, `resolution_actor =
   * 'human'`). No consent (a DB row state). `'finding-already-fixed'`
   * (409) / `'not-found'` (404). Resolves on `204`; the caller
   * re-fetches. Demo rejects `'demo-readonly'`.
   */
  resolveFinding(nodePath: string, findingId: number, note?: string): Promise<void>;

  /**
   * `POST /api/nodes/:pathB64/findings/undismiss`, the restore button on
   * a revealed dismissed row. EXACT identity (the row's qualified
   * `extension` + `type`); same consent handshake as `dismissFinding`.
   * The class's stored rows show again immediately (read-time lens).
   * No-match `'not-found'` (404, the BFF self-heals the mirror first).
   * Resolves on `204`. Demo rejects `'demo-readonly'`.
   */
  undismissFinding(
    nodePath: string,
    entry: { extension: string; type?: string },
    opts?: { confirm?: boolean; always?: boolean },
  ): Promise<void>;

  /**
   * `DELETE /api/nodes/:pathB64/findings/:id`, the delete X on a REVEALED
   * dismissed / fixed row: hard-deletes the row from `state_findings`
   * (per-row twin of `sm findings clear`, all origins). Deleting the
   * LAST row of a dismissed class also lifts its exact suppression
   * entry from the `.sm` (else a re-found class comes back hidden),
   * so THAT case shares dismiss's consent handshake (`412`
   * `confirm-required` answered by retrying with `confirm` / `always`);
   * a plain delete needs none. Unknown id `'not-found'` (404). Resolves
   * on `204`; the caller re-fetches. Demo rejects `'demo-readonly'`.
   */
  deleteFinding(
    nodePath: string,
    findingId: number,
    opts?: { confirm?: boolean; always?: boolean },
  ): Promise<void>;

  /**
   * `POST /api/jobs/prune[?status=]`, delete terminal jobs now. With no
   * `status` it clears every terminal state (completed + failed +
   * cancelled), the queue inspector's "clear finished"; with a single
   * terminal `status` it clears just that state (e.g. `'failed'` for "clear
   * failed"). DELIBERATELY distinct from the retention-based CLI
   * `sm jobs prune` (which keeps `failed`). Resolves on `204`; prune emits
   * NO WS event, so the caller MUST re-fetch. Demo mode rejects with
   * `'demo-readonly'`.
   */
  pruneJobs(status?: 'completed' | 'failed' | 'cancelled'): Promise<void>;
}
