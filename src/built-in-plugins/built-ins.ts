/**
 * Built-in extension registry. Returns every extension bundled with the
 * reference implementation, grouped by plugin bundle, ready to be
 * registered on a Kernel.
 *
 * Keeping runtime references separate from the manifest-only entries the
 * Registry indexes: a consumer that only needs to list what's bundled
 * iterates `listBuiltIns()` for cheap manifest facts, while the
 * orchestrator needs the concrete `IProvider` / `IExtractor` / ... values
 * to actually call walk / extract / evaluate / format. Two exports
 * keep both access patterns first-class.
 *
 * **Spec § A.6 — qualified ids.** Every built-in declares its `pluginId`
 * directly in its module export (built-ins have no `plugin.json`, so
 * the bundle declaration IS the source of truth for their namespace).
 * Two namespaces by convention:
 *
 *   - **`core/`** — kernel-internal primitives, platform-agnostic. Owns
 *     every rule, the ASCII formatter, the markdown-link / external-URL
 *     counter extractors, and the cross-vendor `annotations` / `slash` /
 *     `at-directive` extractors that any Provider can rely on.
 *   - **`claude/`** — the Claude Code Provider bundle: the Provider that
 *     classifies `.claude/{agents,commands,skills}` paths and parses
 *     their frontmatter. Vendor-specific extractors (if any ever land)
 *     would slot in here; today none do.
 *
 * The registry composes the qualified id `<pluginId>/<id>` at registration
 * time; cross-extension references (`defaultRefreshAction`, future
 * `composes[]`) MUST use the qualified form.
 *
 * **Spec § A.7 — granularity.** Each bundle declares whether the user
 * toggles it whole (`granularity: 'bundle'`) or one extension at a time
 * (`granularity: 'extension'`). The two built-in bundles split:
 *
 *   - `claude` — `granularity: 'bundle'`. The Claude Code platform
 *     integration is enabled or disabled as a whole; the user never
 *     half-enables it. Today the bundle contains only `claudeProvider`
 *     (path classification + frontmatter parser); cross-vendor
 *     extractors moved to `core` once they were proven universal.
 *   - `core`   — `granularity: 'extension'`. Per the spec promise that
 *     "no extension is privileged, removable", every kernel built-in
 *     (each rule, the ASCII formatter, every core extractor) is
 *     independently toggle-able via its qualified id (e.g.
 *     `sm plugins disable core/superseded`, `sm plugins disable core/slash`).
 */

import type {
  IAction,
  IProvider,
  IExtractor,
  IFormatter,
  IHook,
  IRule,
} from '../kernel/extensions/index.js';
import type { Extension } from '../kernel/registry.js';
import type { TGranularity } from '../kernel/types/plugin.js';
import { bucketByKind } from '../kernel/util/bucket-by-kind.js';
import { claudeProvider } from './providers/claude/index.js';
import { geminiProvider } from './providers/gemini/index.js';
import { agentSkillsProvider } from './providers/agent-skills/index.js';
import { coreMarkdownProvider } from './providers/core-markdown/index.js';
import { annotationsExtractor } from './extractors/annotations/index.js';
import { slashExtractor } from './extractors/slash/index.js';
import { atDirectiveExtractor } from './extractors/at-directive/index.js';
import { externalUrlCounterExtractor } from './extractors/external-url-counter/index.js';
import { markdownLinkExtractor } from './extractors/markdown-link/index.js';
import { triggerCollisionRule } from './rules/trigger-collision/index.js';
import { brokenRefRule } from './rules/broken-ref/index.js';
import { supersededRule } from './rules/superseded/index.js';
import { linkConflictRule } from './rules/link-conflict/index.js';
import { annotationStaleRule } from './rules/annotation-stale/index.js';
import { annotationOrphanRule } from './rules/annotation-orphan/index.js';
import { unknownFieldRule } from './rules/unknown-field/index.js';
import { unknownSlotRule } from './rules/unknown-slot/index.js';
import { contributionOrphanRule } from './rules/contribution-orphan/index.js';
import { asciiFormatter } from './formatters/ascii/index.js';
import { validateAllRule } from './rules/validate-all/index.js';
import { linkCountsRule } from './rules/link-counts/index.js';
import { bumpAction } from './actions/bump/index.js';

export interface IBuiltIns {
  providers: IProvider[];
  extractors: IExtractor[];
  rules: IRule[];
  /**
   * Built-in actions. Empty until the job subsystem ships (Decision
   * #114 — `IAction` is manifest-only today, runtime invocation is
   * deferred). Carried as a typed field so the bucketing covers all
   * six kinds without conditional checks at call sites.
   */
  actions: IAction[];
  formatters: IFormatter[];
  /**
   * Hooks bundled with the reference impl. Empty in this bump (A.11
   * adds the kind itself; concrete built-in hooks land separately if
   * the demand surfaces — bookkeeping / metrics hooks are the obvious
   * future candidates). Carried as a typed field so call sites can
   * iterate `bundle.hooks` without conditional checks.
   */
  hooks: IHook[];
}

/**
 * Concrete runtime instance of any extension kind a built-in can carry.
 * Mirrors what the orchestrator actually invokes (`walk` / `extract` /
 * `evaluate` / `format` / `on`); composed into the `IBuiltIns` buckets
 * by `builtIns()`. `IAction` is manifest-only today (runtime entry
 * point lands with the job subsystem); kept in the union so the
 * bucketing is structurally exhaustive.
 */
export type TBuiltInExtension = IProvider | IExtractor | IRule | IAction | IFormatter | IHook;

/**
 * One bundle of built-in extensions. The bundle's `id` is the plugin id
 * (`'core'` / `'claude'`) — built-ins have no `plugin.json` so the
 * bundle declaration IS the source of truth for both the namespace and
 * the granularity policy.
 */
export interface IBuiltInBundle {
  id: string;
  granularity: TGranularity;
  /**
   * One- to three-sentence summary of what the bundle ships. Surfaced
   * by the BFF on `GET /api/plugins` (bundle row's `description` field)
   * and rendered as muted secondary text in the SPA's Settings list.
   * Required for built-ins because they have no `plugin.json` to fall
   * back to; user-plugin bundles read this from `plugin.json#/description`.
   */
  description: string;
  extensions: TBuiltInExtension[];
}

/**
 * The built-in bundles, in their canonical order. Consumers that need
 * to apply per-bundle / per-extension policies (the runtime
 * `composeScanExtensions`, `sm plugins list`) iterate this directly.
 *
 * Iteration order is stable: vendor providers first (`claude`,
 * `gemini`, `agent-skills`), then `core` last so the markdown
 * fallback Provider takes the residue after vendor classification.
 * Stable order matters for snapshot tests and CI output diffs.
 */
export const builtInBundles: IBuiltInBundle[] = [
  {
    id: 'claude',
    granularity: 'bundle',
    description:
      'Claude Code platform integration. Classifies files under `.claude/{agents,commands,skills}` and parses Claude-flavored frontmatter.',
    extensions: [
      claudeProvider,
    ],
  },
  {
    id: 'gemini',
    granularity: 'bundle',
    description:
      'Gemini CLI platform integration. Classifies files under `.gemini/{agents,skills}` and parses Gemini-flavored frontmatter.',
    extensions: [
      geminiProvider,
    ],
  },
  {
    id: 'agent-skills',
    granularity: 'bundle',
    description:
      'Open-standard agent skills. Classifies files under `.agents/skills/<name>/SKILL.md` (Anthropic / OpenAI / Google convention).',
    extensions: [
      agentSkillsProvider,
    ],
  },
  {
    id: 'core',
    granularity: 'extension',
    description:
      'Core extensions shared across providers — extractors, rules, formatters, the bump action, and the universal `.md` fallback Provider.',
    extensions: [
      // Provider FIRST within the core bundle so the kindRegistry
      // composer picks it up alongside other providers; orchestration
      // ordering (vendor providers first, core/markdown LAST) is
      // enforced by the bundle list above (claude / gemini /
      // agent-skills precede core). Within the core bundle, the
      // provider's slot among extractors / rules / formatter is
      // irrelevant — the orchestrator buckets by kind before
      // iterating, so this list defines registration order, not
      // execution order.
      coreMarkdownProvider,
      annotationsExtractor,
      atDirectiveExtractor,
      externalUrlCounterExtractor,
      markdownLinkExtractor,
      slashExtractor,
      triggerCollisionRule,
      brokenRefRule,
      supersededRule,
      linkConflictRule,
      annotationStaleRule,
      annotationOrphanRule,
      unknownFieldRule,
      unknownSlotRule,
      contributionOrphanRule,
      asciiFormatter,
      validateAllRule,
      linkCountsRule,
      bumpAction,
    ],
  },
];

/**
 * Bucketed view of every built-in, in the shape the orchestrator
 * consumes. Composed from `builtInBundles` so the source of truth stays
 * single. NOT filtered by `config_plugins` — call sites that need
 * granular gating (`composeScanExtensions`) walk the bundles themselves.
 */
export function builtIns(): IBuiltIns {
  const out: IBuiltIns = {
    providers: [],
    extractors: [],
    rules: [],
    actions: [],
    formatters: [],
    hooks: [],
  };
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      bucketBuiltIn(ext, out);
    }
  }
  return out;
}

/** Flat view as Registry-ready Extension rows. */
export function listBuiltIns(): Extension[] {
  const out: Extension[] = [];
  for (const bundle of builtInBundles) {
    for (const x of bundle.extensions) {
      out.push(toExtensionRow(x));
    }
  }
  return out;
}

/**
 * Drop a built-in into the right bucket for the orchestrator. Shares the
 * dispatch table with `cli/util/plugin-runtime.ts:bucketLoaded` via
 * `bucketByKind` — the only difference is which kinds get a destination
 * array (built-ins surface every kind, including actions; the loaded-
 * plugin path skips actions because they dispatch via the job subsystem,
 * not the scan pipeline).
 */
function bucketBuiltIn(ext: TBuiltInExtension, out: IBuiltIns): void {
  bucketByKind(ext.kind, ext, {
    provider: out.providers,
    extractor: out.extractors,
    rule: out.rules,
    action: out.actions,
    formatter: out.formatters,
    hook: out.hooks,
  });
}

function toExtensionRow(x: TBuiltInExtension): Extension {
  const row: Extension = {
    id: x.id,
    pluginId: x.pluginId,
    kind: x.kind,
    version: x.version,
  };
  if (x.description !== undefined) row.description = x.description;
  if (x.stability !== undefined) row.stability = x.stability;
  if (x.preconditions !== undefined) row.preconditions = x.preconditions;
  if (x.entry !== undefined) row.entry = x.entry;
  return row;
}
