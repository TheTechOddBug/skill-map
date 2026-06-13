/**
 * Action-projection pass: runs every enabled Action that declares a
 * scan-time `project()` over the merged graph after the analyzer pass.
 * An Action's `project()` emits its OWN view contributions (e.g. the
 * `inspector.action.button` that dispatches it), replacing the former
 * "projector analyzer" pattern where a sibling Analyzer computed and
 * emitted the button on the Action's behalf.
 *
 * The emit path MIRRORS the analyzer one (`./analyzers.ts`): the same
 * declared-ref map (`readDeclaredContributionRefs`) + an `emitContribution`
 * closure that AJV-validates the payload against the slot schema before
 * pushing an `IContributionRecord`, and on failure pushes an
 * `IContributionErrorRecord` + fires the `extension.error` event. Accepted
 * emissions reach `scan_contributions` via the same persistence pipeline
 * as analyzer / extractor contributions.
 *
 * `project()` is contractually deterministic and side-effect-free; the
 * orchestrator never lets it write or invoke a runner (the projection ctx
 * exposes only the read-only graph + `emitContribution`).
 */

import type { IAction, IActionProjectionContext } from '../extensions/index.js';
import { loadSchemaValidators } from '../adapters/schema-validators.js';
import type {
  IContributionErrorRecord,
  IContributionRecord,
} from '../adapters/sqlite/contributions.js';
import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type { ProgressEmitterPort } from '../ports/progress-emitter.js';
import { qualifiedExtensionId } from '../registry.js';
import type { Link, Node } from '../types.js';
import type { IViewContribution } from '../types/view-catalog.js';
import { tx } from '../util/tx.js';
import { emitExtensionError, readDeclaredContributionRefs } from './extractors.js';

/**
 * Run the scan-time projection of every Action that declares `project`.
 * Actions without a `project` method are skipped (they only carry the
 * on-demand `invoke` executor). The `actions` array is the COMPOSED
 * enabled set, so a disabled / experimental action never reaches here,
 * the enabled gate is already applied upstream by `composeScanExtensions`.
 *
 * Returns the accepted contributions + the rejected emissions, mirroring
 * `runAnalyzers`' return shape so the orchestrator can merge both into
 * the same per-scan buffers.
 */
export function runActionProjections(
  actions: readonly IAction[],
  nodes: readonly Node[],
  links: readonly Link[],
  emitter: ProgressEmitterPort,
): {
  contributions: IContributionRecord[];
  contributionErrors: IContributionErrorRecord[];
} {
  const contributions: IContributionRecord[] = [];
  const contributionErrors: IContributionErrorRecord[] = [];
  const validators = loadSchemaValidators();

  for (const action of actions) {
    if (typeof action.project !== 'function') continue;
    const qualifiedId = qualifiedExtensionId(action.pluginId, action.id);
    const declaredContributions = readDeclaredContributionRefs(action);
    const emitContribution = (
      nodePath: string,
      ref: IViewContribution,
      payload: unknown,
    ): void => {
      const declared =
        typeof ref === 'object' && ref !== null ? declaredContributions.get(ref) : undefined;
      if (!declared) {
        const message = tx(ORCHESTRATOR_TEXTS.extensionErrorContributionUndeclaredRef, {
          extractorId: qualifiedId,
          nodePath,
        });
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          reason: 'undeclared-contribution-ref',
          message,
        });
        contributionErrors.push({
          pluginId: action.pluginId,
          extensionId: action.id,
          nodePath,
          reason: 'undeclared-contribution-ref',
          message,
          emittedAt: Date.now(),
        });
        return;
      }
      const result = validators.validateContributionPayload(declared.slot, payload);
      if (!result.ok) {
        const message = tx(ORCHESTRATOR_TEXTS.extensionErrorContributionPayloadInvalid, {
          extractorId: qualifiedId,
          contributionId: declared.id,
          nodePath,
          slot: declared.slot,
          errors: result.errors,
        });
        emitExtensionError(emitter, qualifiedId, nodePath, {
          phase: 'emitContribution',
          contributionId: declared.id,
          slot: declared.slot,
          reason: result.errors,
          message,
        });
        contributionErrors.push({
          pluginId: action.pluginId,
          extensionId: action.id,
          nodePath,
          reason: result.errors,
          message,
          contributionId: declared.id,
          slot: declared.slot,
          emittedAt: Date.now(),
        });
        return;
      }
      contributions.push({
        pluginId: action.pluginId,
        extensionId: action.id,
        nodePath,
        contributionId: declared.id,
        slot: declared.slot,
        payload,
        emittedAt: Date.now(),
      });
    };
    const ctx: IActionProjectionContext = { nodes, links, emitContribution };
    action.project(ctx);
  }

  return { contributions, contributionErrors };
}
