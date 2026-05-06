/**
 * Action runtime contract. The fourth plugin kind (spec § A.4 +
 * `spec/schemas/extensions/action.schema.json`).
 *
 * Actions operate on one or more nodes in one of two execution modes:
 *
 *   - `deterministic` — code runs in-process; the action computes the
 *     report synchronously and returns it. No job file, no runner.
 *   - `probabilistic` — the kernel renders a prompt + preamble into a
 *     job file; a runner executes it via `RunnerPort` against an LLM;
 *     `sm record` closes the job and validates the report against
 *     `reportSchemaRef`.
 *
 * **Deferred runtime invocation.** The dispatcher (`Action.run(ctx)` for
 * deterministic; the `RunnerPort` + `sm record` round-trip for
 * probabilistic) lands with the job subsystem (Decision #114 in
 * `ROADMAP.md`). Today the loader still validates `kind: 'action'`
 * manifests against `extension-action.schema.json` and the registry
 * holds them — `sm actions show` and the precondition gating UI consume
 * the manifest data. The runtime entry point is intentionally absent
 * from `IAction` so plugin authors don't ship a method the kernel will
 * not call until the job subsystem is in place; when it ships, the
 * method shape will land here without breaking the manifest contract.
 *
 * Mirrors `extensions/action.schema.json`:
 *
 *   - `mode` (required) — discriminator between the two modes.
 *   - `reportSchemaRef` (required) — JSON Schema reference the report
 *     MUST validate against. MUST extend `report-base.schema.json`.
 *   - `promptTemplateRef` — REQUIRED when `mode: 'probabilistic'`,
 *     FORBIDDEN when `mode: 'deterministic'`. The schema's conditional
 *     `allOf` enforces both directions; the runtime contract simply
 *     surfaces the field as optional and lets the loader catch shape
 *     violations at AJV time.
 *   - `expectedDurationSeconds` — REQUIRED for probabilistic (drives
 *     TTL); advisory for deterministic.
 *   - `precondition` — declarative filter consumed by `--all` fan-out,
 *     UI button gating, `sm actions show`.
 *   - `expectedTools` — hint to Skill / CLI runners about expected
 *     tools (no normative enforcement in v0).
 *   - `fanOutPolicy` — `'per-node'` (default) vs `'batch'`.
 */

import type { IExtensionBase } from './base.js';
import type { TExecutionMode, Node } from '../types.js';

/**
 * Single sidecar write payload an Action can return. Discriminated union so
 * future write kinds (storage rows, plugin KV, etc.) can land additively
 * without breaking consumers that only handle `kind: 'sidecar'`.
 *
 *   - `path` — absolute path to the `.sm` file the kernel must materialise
 *     the change into. Resolved by the Action from the node's absolute
 *     path via `sidecarPathFor()`.
 *   - `changes` — partial sidecar root used as a deep-merge patch (NOT a
 *     full replacement). Arrays REPLACE; objects RECURSE. Reason:
 *     sidecars are shared-write between skill-map core and plugins;
 *     a full replace would clobber `<plugin-id>:` namespaced blocks.
 */
export type TActionWrite =
  | {
      kind: 'sidecar';
      path: string;
      changes: Record<string, unknown>;
    };

/**
 * Result envelope returned by deterministic Actions. The `report` field
 * carries the typed report payload (each Action declares its shape via
 * `reportSchemaRef`); `writes` is opt-in — Actions that do not mutate
 * persistent state simply omit it.
 */
export interface IActionResult<TReport = unknown> {
  report: TReport;
  writes?: TActionWrite[];
}

/**
 * Runtime context passed to a deterministic Action's `invoke()` method.
 * Minimal surface — Actions stay pure (no IO inside `invoke`); the kernel
 * materialises any returned `writes` after the call.
 *
 *   - `node` — the target `Node` the Action operates on. Open-by-design;
 *     batch / fan-out flows pick the matching nodes upstream.
 *   - `nodeAbsolutePath` — absolute path to the node's `.md` file on
 *     disk. The Action uses this to compute the sidecar path it returns
 *     in a `TActionWrite`. Surfaced separately from `node.path` (which is
 *     the relative scope-root form) so Actions never compose absolute
 *     paths from `node.path` themselves.
 *   - `invoker` — identity of the caller; written into the sidecar's
 *     `audit.lastBumpedBy` when the Action chooses to. CLI invocations
 *     pass `'cli'`; plugin-driven invocations pass `'plugin:<plugin-id>'`.
 *   - `now` — clock function; tests inject a deterministic source.
 *     Defaults to `() => new Date()` at the composition root.
 */
export interface IActionContext {
  node: Node;
  nodeAbsolutePath: string;
  invoker: string;
  now: () => Date;
}

/**
 * Declarative filter applied by `--all` fan-out, UI button gating, and
 * `sm actions show`. All fields optional — an empty precondition matches
 * every node.
 */
export interface IActionPrecondition {
  /**
   * Node kinds this action accepts. Open-by-design (matches
   * `node.schema.json#/properties/kind`): an action declared with
   * `kind: ['cursorRule']` is valid as long as some Provider classifies
   * into `cursorRule`. Omitted → any kind.
   */
  kind?: string[];
  /** Provider ids whose nodes this action accepts. Omitted → any Provider. */
  provider?: string[];
  /** Node stability filter. */
  stability?: Array<'experimental' | 'stable' | 'deprecated'>;
  /**
   * Free-form precondition strings the kernel forwards to the action for
   * runtime evaluation (example: `frontmatter.metadata.source != null`).
   */
  custom?: string[];
}

export interface IAction extends IExtensionBase {
  kind: 'action';
  /**
   * Execution mode discriminator. Required per
   * `extensions/action.schema.json`.
   */
  mode: TExecutionMode;
  /**
   * Reference to the JSON Schema the report MUST validate against. MUST
   * extend `report-base.schema.json` (directly or transitively).
   * Validation failure → job transitions to `failed` with reason
   * `report-invalid`.
   */
  reportSchemaRef: string;
  /**
   * Best-effort estimate of wall-clock duration in seconds. Drives TTL
   * (`ttl = max(expectedDurationSeconds × graceMultiplier,
   * minimumTtlSeconds)`). Required for `probabilistic`; advisory for
   * `deterministic`.
   */
  expectedDurationSeconds?: number;
  /**
   * Path (relative to the extension file) to the prompt template the
   * kernel renders at `sm job submit`. REQUIRED when `mode:
   * 'probabilistic'`; FORBIDDEN when `mode: 'deterministic'`. The
   * conditional shape is enforced by AJV at load time; the runtime
   * contract carries the field as optional so both modes share one
   * interface.
   */
  promptTemplateRef?: string;
  /**
   * Optional declarative filter; absent → applies to every node.
   */
  precondition?: IActionPrecondition;
  /**
   * Hint to Skill / CLI runners about what tools the rendered prompt
   * expects access to (`Bash`, `Read`, `WebSearch`, …). No normative
   * enforcement in v0.
   */
  expectedTools?: string[];
  /**
   * `'per-node'` (default): `sm job submit --all` produces one job per
   * matching node. `'batch'`: one job whose prompt template receives the
   * full list. Batch actions tend to hit context limits; use sparingly.
   */
  fanOutPolicy?: 'per-node' | 'batch';
  /**
   * Deterministic invocation entry point. OPTIONAL on the runtime
   * contract for backward compatibility with the manifest-only era
   * (Decision #114) — actions that ship for the future probabilistic
   * runner / record path leave it absent and the kernel never calls it.
   * Step 9.6.3 (Decision #125) introduces the first concrete consumer:
   * the built-in `bump` Action implements `invoke()` and returns a
   * `writes: [{ kind: 'sidecar', ... }]` payload that the kernel
   * materialises through `ISidecarStore`.
   *
   * Implementations MUST stay pure — no IO inside `invoke()`. The Action
   * computes the patch and returns it; the kernel reads the on-disk
   * sidecar, deep-merges, validates, and writes back inside its critical
   * section.
   *
   * `TInput` is action-specific; the built-in `bump` Action declares
   * `{ force?: boolean; reason?: string }`. The signature stays generic
   * so each Action narrows it locally without forcing a common base.
   */
  invoke?: <TInput, TReport>(
    input: TInput,
    ctx: IActionContext,
  ) => IActionResult<TReport>;
}
