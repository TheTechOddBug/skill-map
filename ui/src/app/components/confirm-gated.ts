/**
 * Shared 412 `confirm-required` retry runner.
 *
 * Every consent-gated mutation in the SPA follows the same server-enforced
 * shape (`spec/cli-contract.md` §HTTP API): fire the write WITHOUT
 * `confirm`, let the BFF refuse 412 `confirm-required` (nothing written),
 * surface a consent dialog naming the exact surface the write would touch,
 * and retry with `confirm: true` only after the operator accepts. The
 * MECHANISM is identical across surfaces; the dialog copy and the
 * busy-state contract are not, so both stay at the call site: `confirm`
 * presents whatever dialog the surface owns (each keeps its own texts),
 * and pending-key bookkeeping wraps the runner from outside (some surfaces
 * hold their key through the dialog, others release it once the dialog is
 * up).
 *
 * Extracted from five hand-rolled copies (the Quick Start row machines and
 * the Settings > Project hook / skill / preferences children); the
 * preferences child's `runPatch` was the proven shape this generalises.
 * Lives at the components root (like `severity-map.ts`) because both the
 * settings-modal and quick-start-modal families consume it.
 */

import { DataSourceError } from '../../services/data-source/data-source.port';

export interface IConfirmGatedContext {
  /**
   * Paths the 412 envelope exposed (`scan.referencePaths` writes ship the
   * folder list structured as `error.details.paths`, per
   * `spec/cli-contract.md` §PATCH /api/project-preferences; every other
   * consent gate carries none). Absent or malformed = empty.
   */
  readonly exposed: readonly string[];
}

/**
 * Narrow the 412 envelope's `details` to the structured exposed-path
 * list. The wire contract is `details: { paths: string[] } | null`;
 * anything else (older servers, other consent gates) collapses to [].
 */
function exposedPathsOf(details: unknown): readonly string[] {
  if (details === null || typeof details !== 'object') return [];
  const paths = (details as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === 'string');
}

/**
 * Per-surface consent presentation injected into `runConfirmGated`:
 * present the dialog and resolve `true` on accept, `false` on dismiss.
 */
export type TConfirmFlow = (ctx: IConfirmGatedContext) => Promise<boolean>;

export interface IConfirmGatedFlow {
  /**
   * Fire the mutation (and adopt its response envelope). `confirm` is
   * `false` on the first try and `true` on the accepted retry.
   */
  attempt(confirm: boolean): Promise<void>;
  /**
   * Consent dialog for a caught 412. Omit for writes that are never
   * consent-gated: an unexpected `confirm-required` then routes to
   * `onError` like any other failure (mirrors the pre-extraction copies).
   */
  confirm?: TConfirmFlow;
  /**
   * Sink for non-412 failures AND for a failed confirmed retry. The
   * runner never rethrows; every call site formats + surfaces the error
   * on its own banner and settles.
   */
  onError(err: unknown): void;
}

/**
 * Run `attempt(false)`; on a 412 `confirm-required` with a supplied
 * `confirm` flow, present it and retry `attempt(true)` on accept; on
 * dismiss settle quietly. Resolves `true` only when the write actually
 * persisted: `false` on validation errors, a dismissed dialog, or a
 * failed retry. The promise settles only after the WHOLE flow settles,
 * INCLUDING the consent dialog, so callers can hold busy state through it
 * (toggles stay disabled until the user decides) or roll optimistic view
 * state back.
 */
export async function runConfirmGated(flow: IConfirmGatedFlow): Promise<boolean> {
  try {
    await flow.attempt(false);
    return true;
  } catch (err) {
    if (err instanceof DataSourceError && err.code === 'confirm-required' && flow.confirm) {
      const exposed = exposedPathsOf(err.details);
      if (await flow.confirm({ exposed })) {
        try {
          await flow.attempt(true);
          return true;
        } catch (innerErr) {
          flow.onError(innerErr);
          return false;
        }
      }
      return false;
    }
    flow.onError(err);
    return false;
  }
}
