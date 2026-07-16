/**
 * Hook lifecycle dispatcher (spec § A.11). Indexes the supplied hooks
 * by trigger and fans the matching event out to every subscribed
 * deterministic hook in registration order. Probabilistic hooks are
 * skipped here with a stderr advisory; they will dispatch via the job
 * subsystem once it ships (Decision #114).
 *
 * Filter handling: when the hook declares a `filter` map, the dispatcher
 * walks `event.data` for each declared key and short-circuits the
 * invocation when any value disagrees. Top-level fields only in v0.x
 * (deep-path matching is deferred until a real use case justifies the
 * complexity).
 *
 * Error policy: a hook that throws is caught here, logged through a
 * synthetic `extension.error` event with kind `hook-error`, and the
 * caller continues. A buggy hook MUST NOT block the main pipeline (or
 * the CLI exit path), that would invert the design intent (hooks
 * REACT to events, they never steer them).
 *
 * The module lives under `kernel/extensions/` (alongside the `IHook`
 * contract itself) so two callers share it: `runScan` for the eight
 * pipeline-driven triggers (`scan.*`, `extractor.completed`,
 * `analyzer.completed`, `action.completed`, `job.*`) and the CLI entry
 * for the two CLI-process-driven triggers (`boot`, `shutdown`).
 * Pulling the dispatcher out of the orchestrator keeps both consumers
 * symmetric, same indexing, same filter semantics, same error
 * policy.
 */

import type { IHook, IHookActionInfo, IHookContext, THookTrigger } from './hook.js';
import type { Node } from '../types.js';
import type { ProgressEmitterPort, ProgressEvent } from '../ports/progress-emitter.js';
import { qualifiedExtensionId } from '../registry.js';
import { formatErrorMessage } from '../util/format-error.js';
import { log } from '../util/logger.js';

/**
 * Optional runtime capabilities the DRIVER supplies so a hook can react
 * beyond pure observation. Only the record-path dispatch wires these today
 * (for the opt-in `core/auto-fix` hook); the scan / boot dispatchers omit
 * them and the fields stay `undefined` on `IHookContext`.
 *
 *   - `queue`, enqueue a probabilistic Action as a deferred job. Attached
 *     to `ctx.queue`. The driver owns the async lifecycle (it collects the
 *     requests and drains them while its DB handle is still open), so the
 *     hook-facing signature stays fire-and-forget `void`.
 *   - `actions`, the loaded-Action projection (`IHookActionInfo[]`).
 *     Attached to `ctx.actions` so a hook can resolve the inverse of
 *     Modelo B without importing the registry.
 */
export interface IHookDispatchCapabilities {
  queue?: (actionId: string, payload: unknown) => void;
  actions?: readonly IHookActionInfo[];
}

export interface IHookDispatcher {
  /**
   * Fan the event out to every hook subscribed to `trigger`. Awaits each
   * hook's `on(ctx)` in registration order. Errors are caught and
   * logged via `extension.error`; they never propagate.
   */
  dispatch(trigger: THookTrigger, event: ProgressEvent): Promise<void>;
}

/**
 * Build a dispatcher over the given hooks. Empty `hooks` returns a
 * cheap no-op shape so the call sites can dispatch unconditionally.
 * `capabilities` (optional) supplies the driver-provided `queue` / `actions`
 * that `buildHookContext` threads onto each `IHookContext`.
 */
export function makeHookDispatcher(
  hooks: IHook[],
  emitter: ProgressEmitterPort,
  capabilities?: IHookDispatchCapabilities,
): IHookDispatcher {
  if (hooks.length === 0) {
    // Cheap no-op fast path: most scans don't carry any hooks today.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { dispatch: async () => {} };
  }

  // Index by trigger so dispatch is O(matching) rather than O(allHooks).
  // Iteration order within a trigger preserves registration order so
  // observers see deterministic fan-out.
  const byTrigger = new Map<THookTrigger, IHook[]>();
  for (const hook of hooks) {
    // Hooks are deterministic-only since the structure-as-truth refactor;
    // LLM dispatch is modeled as a Hook that enqueues a probabilistic
    // Action via `ctx.queue('<plugin>/<action>', payload)`.
    for (const trig of hook.triggers) {
      const bucket = byTrigger.get(trig);
      if (bucket) bucket.push(hook);
      else byTrigger.set(trig, [hook]);
    }
  }

  return {
    async dispatch(trigger, event) {
      const subs = byTrigger.get(trigger);
      if (!subs || subs.length === 0) return;
      for (const hook of subs) {
        if (!matchesFilter(hook, event)) continue;
        const ctx = buildHookContext(hook, trigger, event, capabilities);
        try {
          await hook.on(ctx);
        } catch (err) {
          const qualifiedId = qualifiedExtensionId(hook.pluginId, hook.id);
          const message = formatErrorMessage(err);
          emitter.emit(
            makeEvent('extension.error', {
              kind: 'hook-error',
              extensionId: qualifiedId,
              trigger,
              message,
            }),
          );
        }
      }
    },
  };
}

/** Construct a `ProgressEvent` envelope. Mirrors the orchestrator helper. */
export function makeEvent(type: string, data: unknown): ProgressEvent {
  return { type, timestamp: new Date().toISOString(), data };
}

function matchesFilter(hook: IHook, event: ProgressEvent): boolean {
  if (!hook.filter) return true;
  const data = (event.data ?? {}) as Record<string, unknown>;
  for (const [key, expected] of Object.entries(hook.filter)) {
    if (data[key] !== expected) return false;
  }
  return true;
}

// Builds a per-trigger context shape: each `THookTrigger` variant
// pulls a different slice of the progress event. The switch IS the
// contract; splitting per trigger scatters the dispatch table. Per
// `context/lint.md` category 6 (discriminated-union dispatchers).
// eslint-disable-next-line complexity
function buildHookContext(
  _hook: IHook,
  trigger: THookTrigger,
  event: ProgressEvent,
  capabilities?: IHookDispatchCapabilities,
): IHookContext {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const ctx: IHookContext = {
    // `settings` is always populated (possibly empty) so hooks can read
    // `ctx.settings.<id>` without a presence check. The composer
    // populated `resolvedSettings` on each composed hook.
    settings: _hook.resolvedSettings ?? {},
    event: {
      type: trigger,
      // Hook events carry ISO-8601 strings (`IHookEvent.timestamp`);
      // job-event envelopes carry Unix ms. Convert at this seam so the
      // hook contract stays stable regardless of the emitting family.
      timestamp:
        typeof event.timestamp === 'number'
          ? new Date(event.timestamp).toISOString()
          : event.timestamp,
      ...(event.runId !== undefined ? { runId: event.runId } : {}),
      ...(typeof event.jobId === 'string' ? { jobId: event.jobId } : {}),
      data: event.data,
    },
  };
  if (typeof data['extractorId'] === 'string') ctx.extractorId = data['extractorId'];
  if (typeof data['analyzerId'] === 'string') ctx.analyzerId = data['analyzerId'];
  if (typeof data['actionId'] === 'string') ctx.actionId = data['actionId'];
  if (data['node'] && typeof data['node'] === 'object') {
    ctx.node = data['node'] as Node;
  }
  if (data['jobResult'] !== undefined) ctx.jobResult = data['jobResult'];
  // Driver-supplied capabilities (record-path dispatch only): the queue
  // sink + the loaded-Action projection the auto-fix hook resolves against.
  if (capabilities?.queue) ctx.queue = capabilities.queue;
  if (capabilities?.actions) ctx.actions = capabilities.actions;
  return ctx;
}
