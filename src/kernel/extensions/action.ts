/**
 * Action runtime contract. The fourth plugin kind (spec § A.4 +
 * `spec/schemas/extensions/action.schema.json`).
 *
 * Actions operate on one or more nodes in one of two execution modes:
 *
 *   - `deterministic` (default), code runs in-process; the action computes
 *     the report synchronously and returns it. No job, no handover.
 *   - `probabilistic`, the kernel renders `<action-dir>/prompt.md` + preamble
 *     into a queued job; an external agent claims it (`sm jobs claim`),
 *     runs it against an LLM, and `sm record` closes the job by
 *     validating the report against `<action-dir>/report.schema.json`.
 *
 * **Structure-as-truth file conventions**: every Action carries
 * `<action-dir>/report.schema.json` (the JSON Schema for the report, MUST
 * extend `report-base.schema.json`). Probabilistic Actions additionally
 * carry `<action-dir>/prompt.md` (the prompt template). The loader resolves
 * both by convention; missing or mis-placed files surface as `load-error`.
 * The `reportSchemaRef` / `promptTemplateRef` manifest fields were retired
 * with the same refactor.
 *
 * **Built-in inlined siblings**: an on-disk plugin has a source directory
 * at runtime, so the kernel reads `prompt.md` / `report.schema.json` off
 * disk. A BUILT-IN Action bundles into `src/plugins/built-ins.ts` as a plain
 * manifest object with no source directory, so the built-ins codegen
 * (`scripts/generate-built-ins.js`) reads those sibling files at build time
 * and inlines their content onto the manifest as `promptTemplate` (the
 * `prompt.md` text) and `reportSchema` (the parsed `report.schema.json`).
 * These two fields are the built-in equivalent of the on-disk files; they
 * are absent on on-disk plugins.
 *
 * **`prob*` prefix convention**: manifest fields that only apply when
 * `mode=probabilistic` start with `prob`. Today only
 * `probExpectedDurationSeconds` follows this convention.
 *
 * **Deferred runtime invocation**: the dispatcher (`Action.invoke(input, ctx)`
 * for deterministic; the `sm jobs claim` + `sm record` handover for
 * probabilistic) lands fully with the job subsystem (Decision #114 in
 * `ROADMAP.md`). The kernel today still validates manifests and surfaces
 * the precondition gating to the UI; the runtime entry point stays
 * optional until the job subsystem ships.
 */

import type { IExtensionBase } from './base.js';
import type { TExecutionMode, Link, Node } from '../types.js';
import type { IViewContribution } from '../types/view-catalog.js';

export type TActionWrite =
  | {
      kind: 'sidecar';
      path: string;
      changes: Record<string, unknown>;
    };

/**
 * The IO capabilities an Action manifest may declare via `IAction.io`
 * (mirrors `spec/schemas/extensions/action.schema.json#/properties/io`).
 * Today the union has a single member (`'network'`): `invoke()` is pure
 * by contract, and an Action that MUST reach the network (the
 * provenance verifier `github/enrichment`) declares it here, which
 * (a) relaxes the purity rule for exactly that capability, (b) injects
 * `ctx.fetch` into its invocation context, and (c) subjects execution
 * to the committed project policy `allowNetworkActions` (default
 * `false`). Declared-network Actions execute only via `sm refresh`,
 * never inside `sm scan` and never as queued jobs.
 */
export type TActionIoKind = 'network';

/**
 * The discriminant kinds an Action may emit through `IActionResult.writes`.
 * Today the union has a single member (`'sidecar'`); the alias keeps the
 * manifest `writes` capability (`IAction.writes`) in lock-step with the
 * runtime write union so a new write kind only has to be added in one place.
 */
export type TActionWriteKind = TActionWrite['kind'];

export interface IActionResult<TReport = unknown> {
  report: TReport;
  writes?: TActionWrite[];
}

export interface IActionContext {
  node: Node;
  nodeAbsolutePath: string;
  invoker: string;
  now: () => Date;
  /**
   * Resolved values of the Action's declared `settings`. Empty when no
   * settings are declared on the manifest.
   */
  settings: Record<string, unknown>;
  /**
   * Injected network entry point, present ONLY when the Action's
   * manifest declares `io: ['network']` (the single sanctioned
   * carve-out from the extension-purity rule, see
   * `spec/architecture.md` §Extension purity). Implementations MUST
   * route every remote call through it and never touch a global
   * `fetch`: the injection is what lets the dispatcher (`sm refresh`)
   * enforce the `allowNetworkActions` policy and lets tests substitute
   * a fake transport. Absent on every other Action's context.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Read-only graph context handed to an Action's scan-time `project()`
 * method. Mirrors the Analyzer emit path (`IAnalyzerContext`): the
 * Action sees the full merged graph (`nodes` + `links`) and emits its
 * own per-node view contributions via `emitContribution`, supplying the
 * target node path explicitly because, like the Analyzer, it walks the
 * whole graph rather than running per-node.
 *
 * The contribution is declared in the Action's manifest `ui` map and
 * passed BY REFERENCE (same object-identity model as Extractor /
 * Analyzer emit). The orchestrator validates the payload against the
 * slot's schema at call time, dropping invalid emissions with an
 * `extension.error` event.
 *
 * `project()` is strictly DETERMINISTIC and side-effect-free: no writes,
 * no runner, no IO. It runs during the scan's contribution phase on
 * EVERY scan, exactly like an Analyzer's emit path, so its cost is the
 * same per-scan cost as today's projector analyzers. Even an Action
 * whose `invoke` is `mode: 'probabilistic'` MUST keep `project()`
 * deterministic, only `invoke` may be probabilistic.
 */
export interface IActionProjectionContext {
  readonly nodes: readonly Node[];
  readonly links: readonly Link[];
  emitContribution(nodePath: string, ref: IViewContribution, payload: unknown): void;
}

/**
 * Declarative filter applied by `--all` fan-out, UI button gating, and
 * `sm actions show`. Same shape used by Extractor and Analyzer so the
 * kernel ships a single matcher; the `analyzerIds` field is unique to
 * Action and powers Modelo B (Action declares which Analyzer findings
 * it resolves; replaces the deprecated `Analyzer.recommendedActions`).
 */
export interface IActionPrecondition {
  /**
   * Qualified node kinds this action accepts, written as
   * `<provider-plugin>/<kindName>` (e.g. `claude/agent`). Unknown
   * qualified kinds load OK but surface a `precondition-kind-unknown`
   * warning in `sm plugins doctor`.
   */
  kind?: string[];
  /** Provider ids whose nodes this action accepts. */
  provider?: string[];
  /**
   * Qualified analyzer ids whose findings this action resolves
   * (`<plugin>/<analyzer>` or `<plugin>/<analyzer>:<sub-id>` when the
   * analyzer emits sub-typed issues). The UI matches against this list
   * to surface "Resolve this issue" affordances. Dangling references
   * warn via `recommended-action-missing` in `sm plugins doctor` but
   * do NOT block load.
   */
  analyzerIds?: string[];
  /**
   * Frontmatter-gap gate: the action applies ONLY to nodes whose
   * frontmatter is missing at least one of the listed fields (no
   * frontmatter block, absent field, or empty-string value; a
   * non-string value counts as present). Evaluated by the same shared
   * matcher as `kind` / `provider` (`nodeMatchesPrecondition`), so it
   * gates the BFF launcher classification and the `--all` fan-out
   * alike. E.g. `core/ai-frontmatter-action` declares
   * `['name', 'description']` so its standalone launcher renders only
   * while the file is missing one of them.
   */
  frontmatterMissing?: string[];
}

export interface IAction extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'action';
  /**
   * Execution mode. Optional with default `deterministic` since the
   * structure-as-truth refactor.
   */
  mode?: TExecutionMode;
  /**
   * Best-effort ADVISORY estimate of wall-clock duration in seconds when
   * `mode=probabilistic`. Does NOT arm or compute expiry (Decision #139:
   * TTL is opt-in operator policy); it feeds the `jobs-overdue` doctor
   * check and display surfaces. Required by the schema's conditional for
   * probabilistic Actions; ignored otherwise. Renamed from
   * `expectedDurationSeconds` with the `prob*` prefix convention.
   */
  probExpectedDurationSeconds?: number;
  /**
   * Declared persistent-write capability. Mirrors the `kind`s this
   * Action's `invoke()` may return in `IActionResult.writes`. Today the
   * only kind is `'sidecar'` (the Action creates / modifies a `.sm`
   * annotation sidecar). An Action that returns a sidecar write MUST
   * declare `['sidecar']` here: the manifest declaration is what
   * consumers gate on WITHOUT invoking the action, so the
   * `allowSidecarWriters: false` project policy can drop every
   * sidecar-writer from the scan composer (its `inspector.action.button`
   * never projects) and the sidecar store can refuse the write. Absent =
   * the Action performs no persistent writes (read-only / report-only).
   */
  writes?: TActionWriteKind[];
  /**
   * Optional declarative filter; absent → applies to every node.
   */
  precondition?: IActionPrecondition;
  /**
   * Inlined prompt template for a BUILT-IN probabilistic Action. Populated
   * by the built-ins codegen (`scripts/generate-built-ins.js`) from the
   * Action's sibling `prompt.md` at build time; it is the built-in
   * equivalent of the on-disk `prompt.md` a user plugin resolves from its
   * source directory. Absent on on-disk plugins (which read `prompt.md`
   * from disk) and on deterministic Actions (which ship no prompt).
   */
  promptTemplate?: string;
  /**
   * Inlined report schema for a BUILT-IN probabilistic Action. Populated by
   * the built-ins codegen from the Action's sibling `report.schema.json`
   * (parsed to an object at build time); the built-in equivalent of the
   * on-disk `report.schema.json` a user plugin resolves from its source
   * directory. Absent on on-disk plugins.
   */
  reportSchema?: Record<string, unknown>;
  /**
   * Declared IO capability (mirrors `TActionIoKind`). Absent = fully
   * pure `invoke()`. `['network']` = the Action's `invoke()` reaches
   * the network through the injected `ctx.fetch` (never a global) and
   * is refused at execution while the committed project policy
   * `allowNetworkActions` (default `false`) is off. The manifest
   * declaration is what dispatchers gate on WITHOUT invoking the
   * action, the same posture as `writes`.
   */
  io?: TActionIoKind[];
  /**
   * Deterministic invocation entry point. Optional on the runtime
   * contract until the job subsystem ships; Actions that ship for the
   * future probabilistic runner / record path leave it absent.
   * Implementations MUST stay pure (no IO inside `invoke()`) unless the
   * manifest declares the matching `io` capability (today only
   * `'network'`, routed through the injected `ctx.fetch`); the kernel
   * materialises any returned `writes` after the call. The return MAY
   * be a Promise: a declared-network Action is inherently async, so
   * every dispatcher `await`s the result (a plain value awaits to
   * itself, sync Actions stay unchanged).
   */
  invoke?: <TInput, TReport>(
    input: TInput,
    ctx: IActionContext,
  ) => IActionResult<TReport> | Promise<IActionResult<TReport>>;
  /**
   * Optional scan-time self-projection. When present, the orchestrator
   * calls it during the contribution phase (right after the analyzer
   * pass) with read-only graph access, and the Action emits its OWN
   * `inspector.action.button` (or any declared `ui` contribution) per
   * node. This replaces the former "projector analyzer" pattern: the
   * button now lives with the Action that dispatches it, not in a
   * sibling Analyzer.
   *
   * MUST be deterministic and side-effect-free (no writes, no runner,
   * no IO), exactly like an Analyzer's emit path. The button declares
   * its own qualified id as `actionId` in the payload. Actions that ship
   * for the future probabilistic runner / record path leave it absent;
   * an Action MAY declare both `project` and `invoke` (advertiser +
   * executor), or only one.
   */
  project?(ctx: IActionProjectionContext): void;
}
