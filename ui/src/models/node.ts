/**
 * Local TypeScript mirror of `@skill-map/spec/schemas/frontmatter/*.schema.json`
 * + the Claude provider's per-kind schemas. Keep the shapes as a pure
 * reflection of the spec; UI-only fields belong on `INodeView` below.
 *
 * Source-of-truth model post-Step-9.6:
 *   - Universal base (name + description) lives in `frontmatter/base.schema.json`.
 *   - Per-vendor per-kind schemas (agent, skill-base, skill, command, note)
 *     live with the Provider that emits them, for the built-in Claude
 *     Provider, under `src/built-in-plugins/providers/claude/schemas/`.
 *   - Skill-map's annotation layer (versioning, supersession, taxonomy,
 *     ...) lives in co-located `.sm` sidecars (`spec/schemas/annotations.schema.json`),
 *     surfaced via `INodeView.sidecar.annotations`. The pre-Step-9.5
 *     `metadata: {...}` frontmatter block is no longer the canonical home.
 *     Legacy `.md` files that still carry `metadata:` flow through via
 *     `additionalProperties: true`; consumers prefer the sidecar.
 */

/**
 * Open kind type. Step 14.5.d switched from a closed union (limited to
 * the five Claude built-in kinds) to a free `string` so user-plugin
 * Providers can declare their own kinds (`cursorRule`, `daily`, …) and
 * the UI renders them through the runtime `KindRegistryService` instead
 * of a hardcoded enum. The label / color / icon come from the registry,
 * keyed by the same `string`. Pre-14.5.d call sites that switch on
 * literal kind names (`'agent'`, `'command'`, …) still work because
 * the string accepts those exact values; new code should look up
 * presentation through the registry rather than branching on the kind.
 */
export type TNodeKind = string;

export type TStability = 'experimental' | 'stable' | 'deprecated';

/**
 * Universal frontmatter base, mirrors `frontmatter/base.schema.json`.
 * Only `name` and `description` are required; every other field on
 * every per-vendor per-kind interface rides through the
 * `additionalProperties: true` allowance via the index signature.
 *
 * Skill-map-invented fields (provenance, versioning, taxonomy, …) are
 * NOT typed here: post-curation 2026-05-07 their canonical home is the
 * `.sm` sidecar (`INodeView.sidecar.annotations`). Vendor fields belong
 * on the matching kind interface (e.g. `IFrontmatterAgent`), not on
 * the base.
 */
export interface IFrontmatterBase {
  name: string;
  description: string;
  [extra: string]: unknown;
}

/**
 * Anthropic agent frontmatter, mirrors
 * `claude/schemas/agent.schema.json`. Field names are reproduced
 * verbatim from Anthropic's spec (mix of camelCase and snake_case);
 * skill-map AGGREGATES the vendor spec, it does not curate it.
 */
export interface IFrontmatterAgent extends IFrontmatterBase {
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?:
    | 'default'
    | 'acceptEdits'
    | 'auto'
    | 'dontAsk'
    | 'bypassPermissions'
    | 'plan';
  maxTurns?: number;
  skills?: string[];
  mcpServers?: ReadonlyArray<Record<string, unknown>>;
  hooks?: Record<string, unknown>;
  memory?: 'user' | 'project' | 'local';
  background?: boolean;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  isolation?: 'worktree';
  color?: 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan';
  initialPrompt?: string;
}

/**
 * Anthropic shared skill / command base, mirrors
 * `claude/schemas/skill-base.schema.json`. Field naming is reproduced
 * verbatim from Anthropic, a deliberate mix of kebab-case
 * (`argument-hint`, `disable-model-invocation`, `user-invocable`,
 * `allowed-tools`), snake_case (`when_to_use`), and camelCase. Use
 * bracket access in TypeScript for the hyphenated keys
 * (e.g. `fm['allowed-tools']`).
 */
export interface IFrontmatterSkillBase extends IFrontmatterBase {
  when_to_use?: string;
  'argument-hint'?: string;
  arguments?: string | string[];
  'disable-model-invocation'?: boolean;
  'user-invocable'?: boolean;
  'allowed-tools'?: string | string[];
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  context?: 'fork';
  agent?: string;
  hooks?: Record<string, unknown>;
  paths?: string | string[];
  shell?: 'bash' | 'powershell';
}

// Skill / command share the same vendor surface today (Anthropic merged
// commands into skills); skill-map keeps them as distinct kinds in the
// registry but the type surface is identical.
export type IFrontmatterSkill = IFrontmatterSkillBase;
export type IFrontmatterCommand = IFrontmatterSkillBase;

// Notes carry no extra vendor fields, just the universal base.
export type TFrontmatterNote = IFrontmatterBase;

export type TFrontmatter =
  | IFrontmatterAgent
  | IFrontmatterCommand
  | IFrontmatterSkill
  | TFrontmatterNote;

/**
 * UI-facing node shape. Composes the parsed frontmatter with ui-only
 * fields (path, derived kind). This is the type stored in the in-memory
 * collection and passed to list / graph / inspector views.
 *
 * **Body is intentionally absent**, `/api/scan` (the loader's source)
 * doesn't ship body bytes by design (kernel persists `body_hash` only).
 * The Inspector view fetches the body on-demand via
 * `dataSource.getNode(path)` with `?include=body`; everywhere else
 * doesn't need it.
 */
export interface INodeView {
  path: string;
  kind: TNodeKind;
  /**
   * Provider id that classified this node (`claude`, `cursor`, …). Used
   * by the inspector vendor-frontmatter renderer to pick the per-kind
   * tier layout. Optional for legacy / mock paths that pre-date the
   * field; absent → renderer falls back to a generic dump.
   */
  provider?: string;
  frontmatter: TFrontmatter;
  /**
   * Co-located `.sm` sidecar overlay surfaced from the BFF. Drives the
   * card stale badge, the inspector annotations panel, and the bump
   * button gating. Absent when the BFF / static bundle does not ship
   * an overlay for this node.
   */
  sidecar?: ISidecarOverlay;
  /**
   * Catalog-curation card surfaces: outgoing/incoming link counters,
   * external-refs counter, and totals for the inspector stats footer.
   * Projected from the matching `INodeApi.*` fields so the card +
   * inspector can render without re-counting links or re-summing
   * bytes.
   */
  linksOutCount?: number;
  linksInCount?: number;
  externalRefsCount?: number;
  bytesTotal?: number;
  tokensTotal?: number;
  /**
   * Live hashes used by the inspector debug panel to diff against the
   * sidecar's stored `for.bodyHash` / `for.frontmatterHash` and surface
   * which side drifted. Optional, absent when the BFF / static bundle
   * doesn't ship them.
   */
  bodyHash?: string;
  frontmatterHash?: string;
  /**
   * Per-user "favorite" flag set by the local user from this UI.
   * Decorated by the BFF on `/api/nodes` payloads from
   * `state_node_favorites`. Treated as `false` when absent (e.g. on
   * static fixtures that don't carry per-user state).
   */
  isFavorite?: boolean;
  /**
   * Phase 4 / View contribution system, per-node typed payloads
   * emitted by extensions via `ctx.emitContribution(id, payload)`.
   * Mirror of `INodeApi.contributions[]`. Always present on
   * single-node responses; present on bulk-list responses when the
   * BFF page slice fits within `bff.maxBulkContributions` (default
   * 200), absent otherwise (the slot host falls back to lazy
   * `/api/contributions/...` per node).
   */
  contributions?: import('./api').IContributionApi[];
}

/**
 * Sidecar overlay drift status. Mirrors
 * `node.schema.json#/$defs/sidecarOverlay/properties/status`.
 */
export type TSidecarStatus =
  | 'fresh'
  | 'stale-body'
  | 'stale-frontmatter'
  | 'stale-both'
  | null;

export interface ISidecarOverlay {
  present: boolean;
  status?: TSidecarStatus;
  annotations?: Record<string, unknown> | null;
  /**
   * Catalog curation 2026-05-07: the parsed `.sm` root payload (or
   * `null` / absent until the BFF starts shipping it). Used by the
   * inspector's audit panel, plugin-contributions panel, and debug
   * panel to read the `identity:`, `audit:`, and unreserved-namespace
   * blocks. Components defensively render gracefully degraded when
   * absent.
   */
  root?: Record<string, unknown> | null;
}

/**
 * The "stale" set, a node whose sidecar exists but no longer matches
 * the current body / frontmatter hashes. Card surfaces a stale badge
 * for any value in this set; the bump button is enabled.
 */
export const STALE_SIDECAR_STATUSES: ReadonlySet<TSidecarStatus> = new Set([
  'stale-body',
  'stale-frontmatter',
  'stale-both',
]);

export function isStaleSidecar(overlay: ISidecarOverlay | undefined | null): boolean {
  if (!overlay) return false;
  return STALE_SIDECAR_STATUSES.has(overlay.status ?? null);
}

/**
 * Read the legacy pre-Step-9.5 `metadata: {...}` block off the
 * frontmatter when the source `.md` file still carries it. Catalog
 * curation 2026-05-07 made `INodeView.sidecar.annotations` the
 * canonical home for these fields; this fallback exists ONLY for
 * un-migrated user files whose `metadata:` block rides through via
 * `additionalProperties: true` on the universal base schema. Returns
 * `null` when the block is absent or not a plain object.
 */
export function legacyFrontmatterMetadata(
  fm: { readonly [extra: string]: unknown },
): Record<string, unknown> | null {
  const m = fm['metadata'];
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    return m as Record<string, unknown>;
  }
  return null;
}

/**
 * Probabilistic summary report produced by an LLM-backed summarizer
 * action. Shape mirrors `spec/schemas/summaries/<kind>.schema.json`,
 * each kind extends a common `report-base` (confidence + safety) with
 * kind-specific fields. Until real summarizers land in the kernel, the
 * UI keeps these as optional inputs on `<sm-node-card>` so the LLM
 * cluster renders only when data is available.
 */
export interface IReportSafety {
  injectionDetected: boolean;
  injectionType?: 'direct-override' | 'role-swap' | 'hidden-instruction' | 'other' | null;
  injectionDetails?: string | null;
  contentQuality: 'clean' | 'suspicious' | 'malformed';
}

interface IReportBase {
  confidence: number;
  safety: IReportSafety;
}

export interface ISummaryAgent extends IReportBase {
  kind: 'agent';
  whatItDoes: string;
  whenToUse?: string;
  capabilities?: readonly string[];
  toolsObserved?: readonly string[];
  interactionStyle?: string;
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummarySkill extends IReportBase {
  kind: 'skill';
  whatItDoes: string;
  recipe?: readonly { step: number; description: string }[];
  preconditions?: readonly string[];
  outputs?: readonly string[];
  sideEffects?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummaryCommand extends IReportBase {
  kind: 'command';
  whatItDoes: string;
  invocationExample?: string;
  argsObserved?: readonly { name: string; type?: string; description?: string; required?: boolean }[];
  sideEffects?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export interface ISummaryMarkdown extends IReportBase {
  kind: 'markdown';
  whatItCovers: string;
  topics?: readonly string[];
  keyFacts?: readonly string[];
  relatedNodes?: readonly string[];
  qualityNotes?: string;
}

export type TSummary =
  | ISummaryAgent
  | ISummarySkill
  | ISummaryCommand
  | ISummaryMarkdown;

/**
 * Deterministic finding emitted by a rule (`spec/schemas/issue.schema.json`).
 * `info` severity is filtered out before reaching the card, only
 * `error` and `warn` surface in the node UI.
 */
export interface IIssue {
  analyzerId: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  detail?: string | null;
}

/**
 * Node-derived counts the kernel computes during scan. Until the
 * kernel publishes these on `INodeView`, the graph layout passes
 * a sibling `INodeStats` so `<sm-node-card>` can render the footer
 * + subtitle pills without recomputing per-frame.
 */
export interface INodeStats {
  bytesTotal?: number;
  tokensTotal?: number;
  linksIn: number;
  linksOut: number;
  externalRefsCount?: number;
  errorCount?: number;
  warnCount?: number;
}
